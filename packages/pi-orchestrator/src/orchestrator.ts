/**
 * Central Orchestrator for PWPI Multi-Agent Architecture.
 * Coordinates Antigravity (Master) and Antigravity2 (Worker).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, loadOrchestratorConfig } from "./config.ts";
import { FileOwnershipManager } from "./file-ownership.ts";
import { OrchestratorLogger } from "./logger.ts";
import { MasterAgent } from "./master-agent.ts";
import type {
	MainTaskInfo,
	OrchestratorConfig,
	OrchestratorEvent,
	OrchestratorStatus,
	TaskResult,
	WorkerTask,
	WorkerTaskRecord,
} from "./types.ts";
import { WorkerAgent, type WorkerExecutionOptions } from "./worker-agent.ts";
import { type WorkerWorkspace, WorkspaceManager } from "./workspace.ts";

export interface CreateTaskParams {
	title: string;
	description: string;
	scope?: string[];
	allowed_files?: string[];
	run_tests?: boolean;
	test_command?: string;
	timeout_ms?: number;
	taskId?: string;
}

export class Orchestrator {
	readonly cwd: string;
	readonly config: OrchestratorConfig;
	readonly logger: OrchestratorLogger;
	readonly fileOwnership: FileOwnershipManager;
	readonly workspaceManager: WorkspaceManager;

	readonly master: MasterAgent;
	readonly worker: WorkerAgent;

	private mainTask?: MainTaskInfo;
	private readonly tasks: Map<string, WorkerTaskRecord> = new Map();
	private readonly workspaces: Map<string, WorkerWorkspace> = new Map();
	private readonly listeners: Set<(event: OrchestratorEvent) => void> = new Set();
	private taskCounter = 0;

	constructor(cwd: string = process.cwd()) {
		this.cwd = cwd;
		this.config = loadOrchestratorConfig(cwd);
		this.logger = new OrchestratorLogger(cwd);
		this.fileOwnership = new FileOwnershipManager(cwd);
		this.workspaceManager = new WorkspaceManager(cwd);

		this.master = new MasterAgent(this.config.agents.master);
		this.worker = new WorkerAgent(this.config.agents.worker);
		this.loadState();
	}

	private getStateFilePath(): string {
		return join(this.cwd, CONFIG_DIR_NAME, "orchestrator-state.json");
	}

	private saveState(): void {
		try {
			const dir = join(this.cwd, CONFIG_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			const serializableTasks = Array.from(this.tasks.entries()).map(([k, v]) => [
				k,
				{
					task: v.task,
					status: v.status,
					result: v.result,
					diff: v.diff,
					workspacePath: v.workspacePath,
					error: v.error,
				},
			]);
			const data = {
				mainTask: this.mainTask,
				taskCounter: this.taskCounter,
				tasks: serializableTasks,
			};
			writeFileSync(this.getStateFilePath(), JSON.stringify(data, null, 2), "utf-8");
		} catch {
			// ignore
		}
	}

	private loadState(): void {
		try {
			const path = this.getStateFilePath();
			if (existsSync(path)) {
				const raw = readFileSync(path, "utf-8");
				const data = JSON.parse(raw);
				if (data.mainTask) {
					this.mainTask = data.mainTask;
				}
				if (typeof data.taskCounter === "number") {
					this.taskCounter = data.taskCounter;
				}
				if (Array.isArray(data.tasks)) {
					for (const [k, v] of data.tasks) {
						this.tasks.set(k, v);
					}
				}
			}
		} catch {
			// ignore
		}
	}

	setMainTask(title: string, description?: string): void {
		this.mainTask = {
			title,
			description,
			status: "running",
		};
		this.master.setActivity(`Working on main task: ${title}`);
		this.master.setStatus("running");
		this.logger.logOrchestration("main_task_updated", `Main task set: "${title}"`);
		this.saveState();
		this.emit({
			type: "main_task_updated",
			timestamp: Date.now(),
			data: this.mainTask,
		});
	}

	getMainTask(): MainTaskInfo | undefined {
		return this.mainTask;
	}

	createTask(params: CreateTaskParams): WorkerTask {
		this.taskCounter++;
		const taskId = params.taskId || `worker-${String(this.taskCounter).padStart(3, "0")}`;

		const task: WorkerTask = {
			agent: this.worker.name,
			task_id: taskId,
			title: params.title,
			description: params.description,
			scope: params.scope,
			allowed_files: params.allowed_files,
			run_tests: params.run_tests,
			test_command: params.test_command,
			timeout_ms: params.timeout_ms ?? this.config.delegation.default_timeout_ms,
			createdAt: Date.now(),
		};

		const record: WorkerTaskRecord = {
			task,
			status: "queued",
		};

		this.tasks.set(taskId, record);
		if (params.allowed_files) {
			this.fileOwnership.assignWorkerFiles(taskId, params.allowed_files);
		}

		this.logger.logOrchestration("task_created", `Task ${taskId} created: "${task.title}"`, taskId);
		this.saveState();
		this.emit({
			type: "task_created",
			taskId,
			agentName: this.worker.name,
			timestamp: Date.now(),
			data: task,
		});

		return task;
	}

	async runTask(taskId: string, options?: WorkerExecutionOptions): Promise<TaskResult> {
		const record = this.tasks.get(taskId);
		if (!record) {
			throw new Error(`Worker task "${taskId}" not found`);
		}

		record.status = "running";
		this.emit({
			type: "task_started",
			taskId,
			agentName: this.worker.name,
			timestamp: Date.now(),
		});

		// Create isolated workspace
		const workspace = await this.workspaceManager.createWorkerWorkspace(taskId, record.task.scope);
		this.workspaces.set(taskId, workspace);
		record.workspacePath = workspace.workspacePath;

		try {
			const result = await this.worker.executeTask(record.task, workspace, {
				logger: this.logger,
				fileOwnership: this.fileOwnership,
				runTurn: options?.runTurn,
			});

			record.result = result;
			record.status = result.status;
			record.diff = await workspace.getDiff();
			this.saveState();

			this.emit({
				type: result.status === "completed" ? "task_completed" : "task_failed",
				taskId,
				agentName: this.worker.name,
				timestamp: Date.now(),
				data: result,
			});

			return result;
		} catch (error: unknown) {
			const errMsg = error instanceof Error ? error.message : String(error);
			record.status = "failed";
			record.error = errMsg;
			const failedResult: TaskResult = {
				task_id: taskId,
				status: "failed",
				summary: `Worker task failed unexpectedly: ${errMsg}`,
				files_changed: [],
				problems: errMsg,
				patch_available: false,
			};
			record.result = failedResult;

			this.emit({
				type: "task_failed",
				taskId,
				agentName: this.worker.name,
				timestamp: Date.now(),
				data: failedResult,
			});

			return failedResult;
		}
	}

	async delegate(params: CreateTaskParams, options?: WorkerExecutionOptions): Promise<TaskResult> {
		const task = this.createTask(params);
		this.master.setActivity(`waiting for worker ${task.agent} on [${task.task_id}]`);
		this.master.addSubtask(`delegated ${task.task_id}: ${task.title}`);

		return this.runTask(task.task_id, options);
	}

	async cancelTask(taskId: string): Promise<boolean> {
		const record = this.tasks.get(taskId);
		if (!record) return false;

		record.status = "cancelled";
		const workspace = this.workspaces.get(taskId);
		if (workspace) {
			await workspace.cleanup();
			this.workspaces.delete(taskId);
		}
		this.fileOwnership.clearWorkerFiles(taskId);

		this.logger.logOrchestration("task_cancelled", `Task ${taskId} cancelled`, taskId);
		this.saveState();
		this.emit({
			type: "task_cancelled",
			taskId,
			agentName: this.worker.name,
			timestamp: Date.now(),
		});

		return true;
	}

	async getDiff(taskId: string): Promise<string> {
		const record = this.tasks.get(taskId);
		if (!record) return "";

		if (record.diff) return record.diff;

		const workspace = this.workspaces.get(taskId);
		if (workspace) {
			const diff = await workspace.getDiff();
			record.diff = diff;
			return diff;
		}

		return "";
	}

	async approveTask(taskId: string): Promise<{ success: boolean; error?: string; filesChanged?: string[] }> {
		const record = this.tasks.get(taskId);
		if (!record) {
			return { success: false, error: `Task "${taskId}" not found` };
		}

		const workspace = this.workspaces.get(taskId);
		if (!workspace) {
			return { success: false, error: `No active workspace found for task "${taskId}"` };
		}

		this.master.setStatus("reviewing");
		this.master.setActivity(`integrating approved changes for ${taskId}`);

		const applyResult = await workspace.applyToTarget(this.cwd);
		if (!applyResult.success) {
			this.master.setStatus("idle");
			return applyResult;
		}

		record.status = "completed";
		this.logger.logOrchestration(
			"task_approved",
			`Task ${taskId} changes approved and integrated by Master`,
			taskId,
			{ filesChanged: applyResult.filesChanged },
		);
		this.saveState();

		await workspace.cleanup();
		this.workspaces.delete(taskId);
		this.fileOwnership.clearWorkerFiles(taskId);

		this.master.setStatus("idle");
		this.master.setActivity(undefined);

		this.emit({
			type: "task_approved",
			taskId,
			timestamp: Date.now(),
			data: applyResult,
		});

		return applyResult;
	}

	async rejectTask(taskId: string, reason?: string): Promise<boolean> {
		const record = this.tasks.get(taskId);
		if (!record) return false;

		record.status = "cancelled";
		const workspace = this.workspaces.get(taskId);
		if (workspace) {
			await workspace.cleanup();
			this.workspaces.delete(taskId);
		}
		this.fileOwnership.clearWorkerFiles(taskId);

		this.logger.logOrchestration(
			"task_rejected",
			`Task ${taskId} rejected by Master: ${reason || "No reason given"}`,
			taskId,
		);
		this.saveState();

		this.emit({
			type: "task_rejected",
			taskId,
			timestamp: Date.now(),
			data: { reason },
		});

		return true;
	}

	getTask(taskId: string): WorkerTaskRecord | undefined {
		return this.tasks.get(taskId);
	}

	getAllTasks(): WorkerTaskRecord[] {
		return Array.from(this.tasks.values());
	}

	getStatus(): OrchestratorStatus {
		return {
			mainTask: this.mainTask,
			master: this.master.getInfo(),
			workers: [this.worker.getInfo()],
			tasks: this.getAllTasks(),
			agentsCount: 2,
		};
	}

	subscribe(listener: (event: OrchestratorEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: OrchestratorEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Ignore listener exceptions
			}
		}
	}
}

// Global orchestrator instance per cwd
const orchestratorRegistry: Map<string, Orchestrator> = new Map();

export function getOrchestrator(cwd: string = process.cwd()): Orchestrator {
	let instance = orchestratorRegistry.get(cwd);
	if (!instance) {
		instance = new Orchestrator(cwd);
		orchestratorRegistry.set(cwd, instance);
	}
	return instance;
}
