/**
 * Terminal Dashboard for PWPI Multi-Agent Orchestrator.
 * Renders an informative real-time terminal box showing Master, Worker, Subtasks, and Task tables.
 */

import chalk from "chalk";
import type { OrchestratorStatus } from "./types.ts";

export function renderDashboard(status: OrchestratorStatus, width: number = 60): string {
	const w = Math.max(50, Math.min(width, 100));
	const innerWidth = w - 2;

	const pad = (text: string, len: number) => {
		// Strip ANSI when measuring length
		const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
		const diff = len - stripped.length;
		return diff > 0 ? text + " ".repeat(diff) : text.slice(0, len);
	};

	const line = (content: string) => `│ ${pad(content, innerWidth - 2)} │`;
	const separator = () => `├${"─".repeat(innerWidth)}┤`;
	const topBorder = () => `┌${"─".repeat(innerWidth)}┐`;
	const bottomBorder = () => `└${"─".repeat(innerWidth)}┘`;

	const formatStatus = (s: string) => {
		switch (s.toLowerCase()) {
			case "running":
				return chalk.green.bold("RUNNING");
			case "completed":
				return chalk.cyan.bold("COMPLETED");
			case "failed":
				return chalk.red.bold("FAILED");
			case "timeout":
				return chalk.yellow.bold("TIMEOUT");
			case "queued":
				return chalk.dim("QUEUED");
			case "cancelled":
				return chalk.gray("CANCELLED");
			default:
				return chalk.white(s.toUpperCase());
		}
	};

	const out: string[] = [];

	// Header
	out.push(topBorder());
	out.push(line(chalk.bold("PWPI - Multi Agent Development")));
	out.push(separator());

	// Agents summary
	const masterStatusStr = formatStatus(status.master.status);
	const masterName = status.master.name.padEnd(18);
	out.push(line(`MASTER     ${masterName} ${masterStatusStr}`));

	for (const worker of status.workers) {
		const workerStatusStr = formatStatus(worker.status);
		const workerName = worker.name.padEnd(18);
		out.push(line(`WORKER     ${workerName} ${workerStatusStr}`));
	}

	out.push(separator());

	// Main task
	out.push(line(chalk.bold("MAIN TASK")));
	out.push(line(status.mainTask?.title || "Interactive Development Session"));
	out.push(line(""));

	// Master details
	out.push(line(chalk.bold("MASTER")));
	if (status.master.subtasks.length > 0) {
		for (let i = 0; i < status.master.subtasks.length; i++) {
			const prefix = i === status.master.subtasks.length - 1 ? "└─" : "├─";
			out.push(line(`${prefix} ${status.master.subtasks[i]}`));
		}
	} else {
		out.push(line(`└─ ${status.master.currentActivity || "analysing repository"}`));
	}

	out.push(line(""));

	// Worker details
	out.push(line(chalk.bold("WORKER")));
	const primaryWorker = status.workers[0];
	if (primaryWorker && primaryWorker.subtasks.length > 0) {
		for (let i = 0; i < primaryWorker.subtasks.length; i++) {
			const prefix = i === primaryWorker.subtasks.length - 1 ? "└─" : "├─";
			out.push(line(`${prefix} ${primaryWorker.subtasks[i]}`));
		}
	} else if (primaryWorker?.currentActivity) {
		out.push(line(`├─ ${primaryWorker.currentActivity}`));
		out.push(line(`└─ ${formatStatus(primaryWorker.status)}`));
	} else {
		out.push(line("└─ idle / awaiting delegation"));
	}

	out.push(separator());

	// Worker tasks table
	out.push(line(chalk.bold("WORKER TASKS")));
	out.push(line(""));

	if (status.tasks.length === 0) {
		out.push(line(chalk.dim("No worker tasks yet")));
	} else {
		for (const record of status.tasks) {
			const id = record.task.task_id.padEnd(12);
			const titleMax = innerWidth - 28;
			const title = pad(record.task.title, titleMax);
			const taskStatus = formatStatus(record.status);
			out.push(line(`${id} ${title} ${taskStatus}`));
		}
	}

	out.push(line(""));
	out.push(separator());

	// Footer
	out.push(line(chalk.dim(`AGENTS: ${status.agentsCount}`)));
	out.push(bottomBorder());

	return out.join("\n");
}
