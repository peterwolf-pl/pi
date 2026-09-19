/**
 * Custom tools for Master Agent (Antigravity) to orchestrate Worker Agent (Antigravity2).
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { Orchestrator } from "./orchestrator.ts";

export const ORCHESTRATOR_SYSTEM_PROMPT_GUIDELINES = [
	"You are Antigravity, the MASTER software-engineering agent. You orchestrate an assistant worker agent named Antigravity2.",
	"DELEGATION ECONOMICS: Delegate tasks ONLY when estimated_worker_value > delegation_overhead.",
	"GOOD delegation candidates: investigating errors/logs, researching APIs, writing isolated tests, auditing specific classes, small isolated component refactors.",
	"POOR delegation candidates: tiny edits, main core implementation, tightly coupled tasks requiring constant shared context, tasks modifying the exact same files as master.",
	"FILE SAFETY: Antigravity2 runs in an isolated git workspace/worktree. Inspect worker results and diffs (using get_worker_diff) before approving (approve_worker_task) or rejecting (reject_worker_task).",
	"Always maintain overall task ownership and run final verification tests before completing the user request.",
];

export function createDelegateTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		title: Type.String({ description: "Short title describing the task for Antigravity2" }),
		description: Type.String({
			description: "Detailed instructions, error logs, requirements, and constraints for Antigravity2",
		}),
		scope: Type.Optional(
			Type.Array(Type.String(), {
				description: "Directories or file patterns within the worker's scope",
			}),
		),
		allowed_files: Type.Optional(
			Type.Array(Type.String(), {
				description: "Exact list of files the worker is permitted to modify or create",
			}),
		),
		run_tests: Type.Optional(
			Type.Boolean({
				description: "Whether Antigravity2 should execute verification tests in its workspace",
			}),
		),
		test_command: Type.Optional(
			Type.String({
				description: "Shell test command for the worker to execute (e.g. './gradlew test', 'npm test')",
			}),
		),
		timeout_ms: Type.Optional(
			Type.Number({
				description: "Worker timeout in milliseconds (default: 300000 / 5 minutes)",
			}),
		),
		wait_for_result: Type.Optional(
			Type.Boolean({
				description: "Whether to wait synchronously for worker result (default: true)",
			}),
		),
	});

	return defineTool({
		name: "delegate_task",
		label: "Delegate Task to Antigravity2",
		description:
			"Delegate a narrowly scoped task (investigation, test writing, API research, isolated component) to worker agent Antigravity2.",
		promptSnippet: "delegate_task - Delegate an isolated task to worker Antigravity2",
		promptGuidelines: ORCHESTRATOR_SYSTEM_PROMPT_GUIDELINES,
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { title, description, scope, allowed_files, run_tests, test_command, timeout_ms, wait_for_result } =
				params as Static<typeof schema>;

			// Evaluate delegation economics
			const evalResult = orchestrator.master.evaluateDelegation({
				title,
				description,
			});

			if (!evalResult.shouldDelegate) {
				return {
					content: [
						{
							type: "text",
							text: `Delegation Warning: ${evalResult.reason}\nMaster should consider handling this task directly unless strict isolation is required.`,
						},
					],
					details: { warning: evalResult.reason },
				};
			}

			if (wait_for_result === false) {
				const task = orchestrator.createTask({
					title,
					description,
					scope,
					allowed_files,
					run_tests,
					test_command,
					timeout_ms,
				});
				// Trigger execution asynchronously
				void orchestrator.runTask(task.task_id);

				return {
					content: [
						{
							type: "text",
							text: `Task delegated asynchronously:\nTask ID: ${task.task_id}\nTitle: ${task.title}\nStatus: queued\nUse check_worker_task to inspect progress.`,
						},
					],
					details: { task_id: task.task_id, status: "queued" },
				};
			}

			const result = await orchestrator.delegate({
				title,
				description,
				scope,
				allowed_files,
				run_tests,
				test_command,
				timeout_ms,
			});

			const diff = await orchestrator.getDiff(result.task_id);
			const review = orchestrator.master.reviewWorkerResult(result, diff);

			let output = `[Antigravity2 Result for Task ${result.task_id}]\n`;
			output += `Status: ${result.status}\n`;
			output += `Summary: ${result.summary}\n`;
			if (result.findings) output += `Findings:\n${result.findings}\n`;
			if (result.files_changed && result.files_changed.length > 0) {
				output += `Files Changed: ${result.files_changed.join(", ")}\n`;
			}
			if (result.tests) {
				output += `Tests: ${result.tests.status} (${result.tests.command || "default"})\n`;
				if (result.tests.output) output += `Test Output:\n${result.tests.output}\n`;
			}
			if (result.recommendation) output += `Recommendation: ${result.recommendation}\n`;
			if (result.problems) output += `Problems Reported: ${result.problems}\n`;
			if (diff) {
				output += `\nPatch Available (use get_worker_diff to view full diff, approve_worker_task to integrate).\n`;
			}
			output += `\nMaster Review Assessment: ${review.action.toUpperCase()} (${review.feedback})\n`;

			return {
				content: [{ type: "text", text: output }],
				details: { task_id: result.task_id, status: result.status, result },
			};
		},
	});
}

export function createCheckWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "Task ID (e.g. 'worker-001')" }),
	});

	return defineTool({
		name: "check_worker_task",
		label: "Check Worker Task",
		description: "Check the status, output, and test results of a task delegated to Antigravity2.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const record = orchestrator.getTask(task_id);

			if (!record) {
				return {
					content: [{ type: "text", text: `Task "${task_id}" not found.` }],
					details: { found: false },
				};
			}

			let text = `Task ID: ${record.task.task_id}\n`;
			text += `Title: ${record.task.title}\n`;
			text += `Status: ${record.status}\n`;
			if (record.result) {
				text += `Summary: ${record.result.summary}\n`;
				if (record.result.findings) text += `Findings:\n${record.result.findings}\n`;
				if (record.result.tests) {
					text += `Tests: ${record.result.tests.status} (${record.result.tests.command})\n`;
				}
				if (record.result.files_changed?.length > 0) {
					text += `Files changed: ${record.result.files_changed.join(", ")}\n`;
				}
			}

			return {
				content: [{ type: "text", text }],
				details: { record },
			};
		},
	});
}

export function createGetWorkerDiffTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "Task ID to inspect diff for" }),
	});

	return defineTool({
		name: "get_worker_diff",
		label: "Get Worker Diff",
		description: "Inspect the git diff and proposed changes generated by Antigravity2 in its isolated workspace.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const diff = await orchestrator.getDiff(task_id);

			if (!diff || diff.trim().length === 0) {
				return {
					content: [{ type: "text", text: `No file changes or diff available for task "${task_id}".` }],
					details: { task_id, hasDiff: false },
				};
			}

			return {
				content: [{ type: "text", text: `--- Worker Workspace Diff [${task_id}] ---\n\n${diff}` }],
				details: { task_id, hasDiff: true, diff },
			};
		},
	});
}

export function createApproveWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "Task ID whose changes should be approved and integrated" }),
	});

	return defineTool({
		name: "approve_worker_task",
		label: "Approve Worker Task",
		description: "Approve and integrate Antigravity2's verified workspace changes into the master working directory.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const res = await orchestrator.approveTask(task_id);

			if (!res.success) {
				return {
					content: [{ type: "text", text: `Approval and integration failed: ${res.error}` }],
					details: { success: false, error: res.error },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully approved and integrated worker changes for "${task_id}".\nFiles updated: ${
							res.filesChanged?.join(", ") || "none"
						}`,
					},
				],
				details: { success: true, filesChanged: res.filesChanged },
			};
		},
	});
}

export function createRejectWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "Task ID whose changes should be rejected" }),
		reason: Type.Optional(Type.String({ description: "Reason for rejecting worker output" })),
	});

	return defineTool({
		name: "reject_worker_task",
		label: "Reject Worker Task",
		description: "Reject Antigravity2's proposed changes and safely clean up the isolated worker workspace.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id, reason } = params as Static<typeof schema>;
			const ok = await orchestrator.rejectTask(task_id, reason);

			if (!ok) {
				return {
					content: [{ type: "text", text: `Task "${task_id}" not found or could not be rejected.` }],
					details: { success: false },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Worker task "${task_id}" rejected and workspace cleaned up. Reason: ${reason || "None specified"}.`,
					},
				],
				details: { success: true, reason },
			};
		},
	});
}

export function createCancelWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "Task ID to cancel" }),
	});

	return defineTool({
		name: "cancel_worker_task",
		label: "Cancel Worker Task",
		description: "Cancel a running or queued worker task.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const ok = await orchestrator.cancelTask(task_id);

			return {
				content: [
					{
						type: "text",
						text: ok ? `Task "${task_id}" cancelled successfully.` : `Task "${task_id}" not found.`,
					},
				],
				details: { success: ok },
			};
		},
	});
}

export function getOrchestratorTools(orchestrator: Orchestrator): ToolDefinition[] {
	return [
		createDelegateTaskTool(orchestrator),
		createCheckWorkerTaskTool(orchestrator),
		createGetWorkerDiffTool(orchestrator),
		createApproveWorkerTaskTool(orchestrator),
		createRejectWorkerTaskTool(orchestrator),
		createCancelWorkerTaskTool(orchestrator),
	];
}
