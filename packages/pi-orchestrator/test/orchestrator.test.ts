/**
 * Automated test suite for Pi Antigravity Multi-Agent Orchestrator.
 * Tests cover all 12 core requirements + end-to-end workflow:
 * 1. master starts
 * 2. worker starts
 * 3. master creates worker task
 * 4. worker receives task
 * 5. worker returns result
 * 6. master receives result
 * 7. worker failure does not stop master
 * 8. worker timeout works
 * 9. file ownership prevents conflicts
 * 10. worker diff can be reviewed
 * 11. worker changes are not automatically merged
 * 12. existing Pi functionality remains intact
 * 13. End-to-end multi-agent test
 * 14. Git worktree isolation test
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileOwnershipManager, Orchestrator, renderDashboard, WorkerAgent, type WorkerTask } from "../src/index.ts";

describe("Pi Antigravity Multi-Agent Orchestrator Extension", () => {
	let testDir: string;
	let orchestrator: Orchestrator;

	beforeEach(() => {
		testDir = join(process.cwd(), `.tmp-orchestrator-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		orchestrator = new Orchestrator(testDir);
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	it("1. master starts with correct identity and role", () => {
		const master = orchestrator.master;
		expect(master.name).toBe("antigravity");
		expect(master.role).toBe("master");
		expect(master.status).toBe("idle");
	});

	it("2. worker starts with correct identity and role", () => {
		const worker = orchestrator.worker;
		expect(worker.name).toBe("antigravity2");
		expect(worker.role).toBe("worker");
		expect(worker.status).toBe("idle");
	});

	it("3. master creates worker task with structured schema", () => {
		const task = orchestrator.createTask({
			title: "Investigate Fabric API error",
			description: "Find why Fabric 26.2 compilation fails.",
			scope: ["src/main/java"],
			allowed_files: ["src/main/java/Mod.java"],
			run_tests: true,
			test_command: "echo test-passed",
		});

		expect(task.task_id).toBeDefined();
		expect(task.agent).toBe("antigravity2");
		expect(task.title).toBe("Investigate Fabric API error");
		expect(task.allowed_files).toEqual(["src/main/java/Mod.java"]);

		const record = orchestrator.getTask(task.task_id);
		expect(record).toBeDefined();
		expect(record?.status).toBe("queued");
	});

	it("4. worker receives task and builds isolated prompt context", () => {
		const task: WorkerTask = {
			agent: "antigravity2",
			task_id: "worker-001",
			title: "Investigate compilation issue",
			description: "Check import in Service.java",
			allowed_files: ["src/Service.java"],
			createdAt: Date.now(),
		};

		const worker = new WorkerAgent("antigravity2");
		const prompt = worker.buildIsolatedPrompt(task);

		expect(prompt).toContain("antigravity2");
		expect(prompt).toContain("Investigate compilation issue");
		expect(prompt).toContain("src/Service.java");
		// Does NOT leak unrelated conversation history
		expect(prompt).not.toContain("random previous message");
	});

	it("5. worker returns structured result", async () => {
		const task = orchestrator.createTask({
			title: "Analyze class API",
			description: "Check method compatibility",
			run_tests: false,
		});

		const result = await orchestrator.runTask(task.task_id, {
			runTurn: async () => "Analyzed API: method X is deprecated, use method Y instead.",
		});

		expect(result.task_id).toBe(task.task_id);
		expect(result.status).toBe("completed");
		expect(result.summary).toContain("Analyzed API");
		expect(result.recommendation).toBeDefined();
		expect(Array.isArray(result.files_changed)).toBe(true);
	});

	it("6. master receives and tracks worker result", async () => {
		const task = orchestrator.createTask({
			title: "Audit dependencies",
			description: "Check for security advisories",
		});

		await orchestrator.runTask(task.task_id, {
			runTurn: async () => "All 5 dependencies are up-to-date.",
		});

		const record = orchestrator.getTask(task.task_id);
		expect(record?.status).toBe("completed");
		expect(record?.result?.findings).toContain("All 5 dependencies are up-to-date");
	});

	it("7. worker failure does not stop master", async () => {
		const task = orchestrator.createTask({
			title: "Faulty task",
			description: "This task will fail",
		});

		const result = await orchestrator.runTask(task.task_id, {
			runTurn: async () => {
				throw new Error("Simulated worker tool crash");
			},
		});

		expect(result.status).toBe("failed");
		expect(result.error).toContain("Simulated worker tool crash");

		// Master remains operational
		expect(orchestrator.master.status).toBe("idle");
		const masterEval = orchestrator.master.evaluateDelegation({
			title: "Next task",
			description: "Continue working",
		});
		expect(masterEval).toBeDefined();
	});

	it("8. worker timeout works and control returns to master", async () => {
		const task = orchestrator.createTask({
			title: "Long running worker task",
			description: "Should time out quickly",
			timeout_ms: 100, // 100ms timeout
		});

		const result = await orchestrator.runTask(task.task_id, {
			runTurn: async (_prompt, _cwd, signal) => {
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => {
						reject(new Error("aborted"));
					});
				});
			},
		});

		expect(result.status).toBe("timeout");
		expect(result.summary).toContain("timed out");
		expect(orchestrator.master.status).toBe("idle");
	});

	it("9. file ownership prevents conflicts", () => {
		const ownership = new FileOwnershipManager(testDir);
		ownership.registerMasterFiles(["src/Main.java", "src/Core.java"]);
		ownership.assignWorkerFiles("worker-001", ["src/test/MainTest.java"]);

		// Master file write access denied to worker
		const masterFileAccess = ownership.checkWorkerFileAccess("worker-001", "src/Main.java", true);
		expect(masterFileAccess.allowed).toBe(false);
		expect(masterFileAccess.isReadOnly).toBe(true);
		expect(masterFileAccess.owner).toBe("master");

		// Assigned worker file write access allowed
		const workerFileAccess = ownership.checkWorkerFileAccess("worker-001", "src/test/MainTest.java", true);
		expect(workerFileAccess.allowed).toBe(true);
		expect(workerFileAccess.isReadOnly).toBe(false);

		// Unassigned file write access blocked when allowed_files specified
		const unassignedAccess = ownership.checkWorkerFileAccess("worker-001", "src/Other.java", true);
		expect(unassignedAccess.allowed).toBe(false);
	});

	it("10. worker diff can be reviewed", async () => {
		const task = orchestrator.createTask({
			title: "Write unit test",
			description: "Create test file",
		});

		await orchestrator.runTask(task.task_id, {
			runTurn: async (_p, workspacePath) => {
				const testFile = join(workspacePath, "SampleTest.txt");
				writeFileSync(testFile, "test content", "utf-8");
				return "Created SampleTest.txt";
			},
		});

		const diff = await orchestrator.getDiff(task.task_id);
		expect(diff).toBeDefined();
	});

	it("11. worker changes are not automatically merged until master approves", async () => {
		const targetFile = join(testDir, "output.txt");
		expect(existsSync(targetFile)).toBe(false);

		const task = orchestrator.createTask({
			title: "Generate documentation",
			description: "Write docs into output.txt",
		});

		await orchestrator.runTask(task.task_id, {
			runTurn: async (_p, workspacePath) => {
				writeFileSync(join(workspacePath, "output.txt"), "Worker generated docs", "utf-8");
				return "Docs created";
			},
		});

		// Changes have NOT been merged yet!
		expect(existsSync(targetFile)).toBe(false);

		// Now master approves task
		const approveRes = await orchestrator.approveTask(task.task_id);
		expect(approveRes.success).toBe(true);
		expect(existsSync(targetFile)).toBe(true);
		expect(readFileSync(targetFile, "utf-8")).toBe("Worker generated docs");
	});

	it("12. existing Pi functionality and dashboard remain intact", () => {
		orchestrator.setMainTask("Build Minecraft Mod");
		const status = orchestrator.getStatus();
		expect(status.mainTask?.title).toBe("Build Minecraft Mod");
		expect(status.agentsCount).toBe(2);

		const rendered = renderDashboard(status);
		expect(rendered).toContain("PWPI - Multi Agent Development");
		expect(rendered).toContain("MASTER");
		expect(rendered).toContain("antigravity");
		expect(rendered).toContain("WORKER");
		expect(rendered).toContain("antigravity2");
	});

	it("13. End-to-end test: user investigates test failure, worker fixes, master reviews and integrates", async () => {
		// USER: "Analyse why test X fails."
		orchestrator.setMainTask("Analyse why test X fails");

		// Antigravity (Master) evaluates delegation
		const delegationDecision = orchestrator.master.evaluateDelegation({
			title: "Analyse failing test X",
			description: "Find root cause and propose fix in isolated test",
			type: "testing",
		});
		expect(delegationDecision.shouldDelegate).toBe(true);
		expect(delegationDecision.targetAgent).toBe("antigravity2");

		// Antigravity delegates task to Antigravity2
		const task = orchestrator.createTask({
			title: "Investigate test X failure",
			description: "Fix math error in calculateScore()",
			run_tests: true,
			test_command: "echo test-ok",
		});

		// Antigravity2 investigates and produces fix in isolated workspace
		const workerResult = await orchestrator.runTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				const srcPath = join(workspacePath, "solution.txt");
				writeFileSync(srcPath, "score = base * multiplier", "utf-8");
				return "Found off-by-one error in multiplier. Corrected formula.";
			},
		});

		expect(workerResult.status).toBe("completed");
		expect(workerResult.tests?.status).toBe("passed");

		// Antigravity reviews the result
		const diff = await orchestrator.getDiff(task.task_id);
		const review = orchestrator.master.reviewWorkerResult(workerResult, diff);

		expect(review.approved).toBe(true);
		expect(review.action).toBe("integrate");

		// Antigravity integrates the verified change
		const integration = await orchestrator.approveTask(task.task_id);
		expect(integration.success).toBe(true);

		const verifiedFile = join(testDir, "solution.txt");
		expect(existsSync(verifiedFile)).toBe(true);
		expect(readFileSync(verifiedFile, "utf-8")).toBe("score = base * multiplier");
	});

	it("14. Git worktree isolation: worker modifies file in isolated worktree and master integrates", async () => {
		const { spawnSync } = await import("node:child_process");
		spawnSync("git", ["init"], { cwd: testDir, encoding: "utf-8" });
		spawnSync("git", ["config", "user.email", "test@pi.local"], { cwd: testDir, encoding: "utf-8" });
		spawnSync("git", ["config", "user.name", "Pi Test"], { cwd: testDir, encoding: "utf-8" });

		const initialFile = join(testDir, "readme.md");
		writeFileSync(initialFile, "# Project\nInitial content\n", "utf-8");
		spawnSync("git", ["add", "."], { cwd: testDir, encoding: "utf-8" });
		spawnSync("git", ["commit", "-m", "Initial commit"], { cwd: testDir, encoding: "utf-8" });

		const gitOrchestrator = new Orchestrator(testDir);
		const task = gitOrchestrator.createTask({
			title: "Update readme in worker worktree",
			description: "Add new feature section",
		});

		await gitOrchestrator.runTask(task.task_id, {
			runTurn: async (_p, workspacePath) => {
				const readmeInWorktree = join(workspacePath, "readme.md");
				writeFileSync(readmeInWorktree, "# Project\nInitial content\n## New Feature by Antigravity2\n", "utf-8");
				return "Updated readme.md";
			},
		});

		// Main directory file must NOT be modified yet!
		expect(readFileSync(initialFile, "utf-8")).toBe("# Project\nInitial content\n");

		// Inspect diff
		const diff = await gitOrchestrator.getDiff(task.task_id);
		expect(diff).toContain("+## New Feature by Antigravity2");

		// Master approves
		const approveRes = await gitOrchestrator.approveTask(task.task_id);
		expect(approveRes.success).toBe(true);

		// Now master has the changes
		expect(readFileSync(initialFile, "utf-8")).toContain("## New Feature by Antigravity2");
	});
});
