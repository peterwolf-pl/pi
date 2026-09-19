/**
 * Builtin extension for PWPI Multi-Agent Orchestrator.
 * Registers tools and slash commands into PWPI sessions.
 */

import type { ExtensionAPI } from "../core/extensions/types.ts";
import { renderDashboard } from "../orchestrator/dashboard.ts";
import { getOrchestrator } from "../orchestrator/orchestrator.ts";
import { getOrchestratorTools } from "../orchestrator/tools.ts";

export default function orchestratorExtension(api: ExtensionAPI): void {
	const orchestrator = getOrchestrator(process.cwd());

	// 1. Register tools for Master Agent (Antigravity)
	const tools = getOrchestratorTools(orchestrator);
	for (const tool of tools) {
		api.registerTool(tool);
	}

	// 2. Register slash commands
	api.registerCommand("agents", {
		description: "Show multi-agent orchestrator agents (Antigravity & Antigravity2)",
		handler: async (_args, ctx) => {
			const status = orchestrator.getStatus();
			let msg = `PWPI Configured Agents:\n`;
			msg += `  MASTER : ${status.master.name} [${status.master.status.toUpperCase()}]\n`;
			for (const w of status.workers) {
				msg += `  WORKER : ${w.name} [${w.status.toUpperCase()}]\n`;
			}
			ctx.ui.notify(msg, "info");
		},
	});

	api.registerCommand("workers", {
		description: "List all tasks assigned to worker agent Antigravity2",
		handler: async (_args, ctx) => {
			const tasks = orchestrator.getAllTasks();
			if (tasks.length === 0) {
				ctx.ui.notify("No worker tasks assigned yet.", "info");
				return;
			}
			let msg = `Worker Tasks:\n`;
			for (const t of tasks) {
				msg += `  [${t.task.task_id}] ${t.task.title} - ${t.status.toUpperCase()}\n`;
			}
			ctx.ui.notify(msg, "info");
		},
	});

	api.registerCommand("status", {
		description: "Display the multi-agent real-time dashboard",
		handler: async (_args, ctx) => {
			const rendered = renderDashboard(orchestrator.getStatus());
			ctx.ui.notify(rendered, "info");
		},
	});

	api.registerCommand("diff", {
		description: "View git diff produced by Antigravity2 for a worker task",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) {
				ctx.ui.notify("Usage: /diff <task_id>", "error");
				return;
			}
			const diff = await orchestrator.getDiff(taskId);
			ctx.ui.notify(diff || "No diff available for this task.", "info");
		},
	});

	api.registerCommand("approve", {
		description: "Approve and merge Antigravity2 changes into the master workspace",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) {
				ctx.ui.notify("Usage: /approve <task_id>", "error");
				return;
			}
			const res = await orchestrator.approveTask(taskId);
			if (res.success) {
				ctx.ui.notify(`Successfully merged changes from ${taskId}`, "info");
			} else {
				ctx.ui.notify(`Approval failed: ${res.error}`, "error");
			}
		},
	});

	api.registerCommand("reject", {
		description: "Reject Antigravity2 changes and clean up the worker workspace",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) {
				ctx.ui.notify("Usage: /reject <task_id>", "error");
				return;
			}
			const ok = await orchestrator.rejectTask(taskId);
			if (ok) {
				ctx.ui.notify(`Rejected task ${taskId} and cleaned up workspace.`, "info");
			} else {
				ctx.ui.notify(`Task ${taskId} not found.`, "error");
			}
		},
	});
}
