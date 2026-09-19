/**
 * PWPI Multi-Agent AI Coding Orchestrator.
 * Extension entrypoint for Pi Coding Agent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderDashboard } from "./dashboard.ts";
import { getOrchestrator } from "./orchestrator.ts";
import { getOrchestratorTools } from "./tools.ts";

export * from "./agent.ts";
export * from "./cli.ts";
export * from "./config.ts";
export * from "./dashboard.ts";
export * from "./file-ownership.ts";
export * from "./logger.ts";
export * from "./master-agent.ts";
export * from "./orchestrator.ts";
export * from "./tools.ts";
export * from "./types.ts";
export * from "./worker-agent.ts";
export * from "./workspace.ts";

export default function orchestratorExtension(pi: ExtensionAPI): void {
	const orchestrator = getOrchestrator(process.cwd());

	// 1. Register tools for Master Agent (Antigravity)
	const tools = getOrchestratorTools(orchestrator);
	for (const tool of tools) {
		pi.registerTool(tool);
	}

	// 2. Register slash commands
	pi.registerCommand("task", {
		description: "Set main task for Antigravity (Master Agent)",
		handler: async (args, ctx) => {
			const title = args.trim();
			if (!title) {
				ctx.ui.notify("Usage: /task <title>", "error");
				return;
			}
			orchestrator.setMainTask(title);
			const rendered = renderDashboard(orchestrator.getStatus());
			ctx.ui.notify(`Main task set: "${title}"\n\n${rendered}`, "info");
		},
	});

	pi.registerCommand("agents", {
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

	pi.registerCommand("workers", {
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

	pi.registerCommand("delegate", {
		description: "Delegate an isolated task to Antigravity2",
		handler: async (args, ctx) => {
			const desc = args.trim();
			if (!desc) {
				ctx.ui.notify("Usage: /delegate <task description>", "error");
				return;
			}
			ctx.ui.notify(`Delegating task to Antigravity2: "${desc}"...`, "info");
			const res = await orchestrator.delegate({
				title: desc,
				description: desc,
			});
			let out = `Antigravity2 finished [${res.task_id}]: ${res.status.toUpperCase()}\n`;
			out += `Summary: ${res.summary}\n`;
			if (res.patch_available) {
				out += `Patch available! Use /diff ${res.task_id} to view, /approve ${res.task_id} to merge.\n`;
			}
			ctx.ui.notify(out, res.status === "completed" ? "info" : "warning");
		},
	});

	pi.registerCommand("status", {
		description: "Display the multi-agent real-time dashboard",
		handler: async (_args, ctx) => {
			const rendered = renderDashboard(orchestrator.getStatus());
			ctx.ui.notify(rendered, "info");
		},
	});

	pi.registerCommand("diff", {
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

	pi.registerCommand("approve", {
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

	pi.registerCommand("reject", {
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
