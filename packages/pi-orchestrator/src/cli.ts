/**
 * CLI command handlers for PWPI Multi-Agent AI Coding Orchestrator.
 */

import chalk from "chalk";
import { renderDashboard } from "./dashboard.ts";
import { getOrchestrator } from "./orchestrator.ts";

export async function handleOrchestratorCommand(
	args: string[],
	options?: { cwd?: string; agentDir?: string },
): Promise<boolean> {
	if (args.length === 0) {
		return false;
	}

	const cmd = args[0].toLowerCase();
	const cwd = options?.cwd || process.cwd();
	const orchestrator = getOrchestrator(cwd);

	switch (cmd) {
		case "task": {
			const taskTitle = args.slice(1).join(" ").trim();
			if (!taskTitle) {
				console.error(chalk.red('Error: Task title is required.\nUsage: pwpi task "<task description>"'));
				process.exit(1);
			}

			orchestrator.setMainTask(taskTitle);
			console.log(chalk.green(`Main task set for Antigravity (Master Agent): "${taskTitle}"\n`));
			console.log(renderDashboard(orchestrator.getStatus()));
			return true;
		}

		case "agents": {
			const status = orchestrator.getStatus();
			console.log(chalk.bold("\nPWPI Configured Agents:"));
			console.log(
				`  ${chalk.cyan("MASTER")} : ${chalk.bold(status.master.name)} [${status.master.status.toUpperCase()}]`,
			);
			for (const w of status.workers) {
				console.log(`  ${chalk.yellow("WORKER")} : ${chalk.bold(w.name)} [${w.status.toUpperCase()}]`);
			}
			console.log("");
			return true;
		}

		case "workers": {
			const tasks = orchestrator.getAllTasks();
			console.log(chalk.bold("\nPWPI Worker Tasks:"));
			if (tasks.length === 0) {
				console.log(chalk.dim("  No worker tasks recorded yet."));
			} else {
				for (const t of tasks) {
					console.log(
						`  ${chalk.bold(t.task.task_id)} | ${t.task.title} | Status: ${chalk.cyan(t.status.toUpperCase())}`,
					);
					if (t.result?.summary) {
						console.log(chalk.dim(`    Summary: ${t.result.summary}`));
					}
				}
			}
			console.log("");
			return true;
		}

		case "delegate": {
			const description = args.slice(1).join(" ").trim();
			if (!description) {
				console.error(
					chalk.red('Error: Delegation description is required.\nUsage: pwpi delegate "<investigate/test error>"'),
				);
				process.exit(1);
			}

			console.log(chalk.cyan(`Delegating task to Antigravity2: "${description}"...`));
			const res = await orchestrator.delegate({
				title: description,
				description,
			});

			console.log(chalk.bold(`\nAntigravity2 Result for [${res.task_id}]:`));
			console.log(`  Status: ${res.status === "completed" ? chalk.green(res.status) : chalk.red(res.status)}`);
			console.log(`  Summary: ${res.summary}`);
			if (res.findings) console.log(`  Findings: ${res.findings}`);
			if (res.tests) console.log(`  Tests: ${res.tests.status} (${res.tests.command || "none"})`);
			if (res.files_changed.length > 0) {
				console.log(`  Files Changed: ${res.files_changed.join(", ")}`);
			}
			if (res.patch_available) {
				console.log(chalk.yellow(`  Patch available. Use "pwpi diff ${res.task_id}" to view diff.`));
				console.log(chalk.green(`  Run "pwpi approve ${res.task_id}" to integrate into master workspace.`));
			}
			return true;
		}

		case "worker": {
			const sub = (args[1] || "").toLowerCase();
			if (sub === "status" || sub === "") {
				console.log(renderDashboard(orchestrator.getStatus()));
				return true;
			}
			if (sub === "cancel") {
				const taskId = args[2];
				if (!taskId) {
					console.error(chalk.red("Error: Task ID required.\nUsage: pwpi worker cancel <task_id>"));
					process.exit(1);
				}
				const ok = await orchestrator.cancelTask(taskId);
				console.log(ok ? chalk.green(`Worker task ${taskId} cancelled.`) : chalk.red(`Task ${taskId} not found.`));
				return true;
			}
			if (sub === "logs") {
				const taskId = args[2];
				const logs = orchestrator.logger.getRecentLogs({ taskId });
				console.log(chalk.bold(`\nPWPI Logs${taskId ? ` for [${taskId}]` : ""}:`));
				if (logs.length === 0) {
					console.log(chalk.dim("  No log entries found."));
				} else {
					for (const l of logs) {
						console.log(`  [${l.timestamp}] [${l.level}] [${l.component}] ${l.message}`);
					}
				}
				return true;
			}
			return false;
		}

		case "diff": {
			const taskId = args[1];
			if (!taskId) {
				console.error(chalk.red("Error: Task ID required.\nUsage: pwpi diff <task_id>"));
				process.exit(1);
			}

			const diff = await orchestrator.getDiff(taskId);
			if (!diff || diff.trim().length === 0) {
				console.log(chalk.dim(`No diff available for worker task "${taskId}".`));
			} else {
				console.log(chalk.bold(`\nWorker Diff [${taskId}]:`));
				console.log(diff);
			}
			return true;
		}

		case "approve": {
			const taskId = args[1];
			if (!taskId) {
				console.error(chalk.red("Error: Task ID required.\nUsage: pwpi approve <task_id>"));
				process.exit(1);
			}

			console.log(chalk.cyan(`Master reviewing and approving worker task "${taskId}"...`));
			const res = await orchestrator.approveTask(taskId);
			if (res.success) {
				console.log(chalk.green(`Successfully integrated changes from task "${taskId}".`));
				if (res.filesChanged && res.filesChanged.length > 0) {
					console.log(`Files updated:\n  ${res.filesChanged.join("\n  ")}`);
				}
			} else {
				console.error(chalk.red(`Failed to integrate changes: ${res.error}`));
				process.exit(1);
			}
			return true;
		}

		case "reject": {
			const taskId = args[1];
			if (!taskId) {
				console.error(chalk.red("Error: Task ID required.\nUsage: pwpi reject <task_id> [reason]"));
				process.exit(1);
			}

			const reason = args.slice(2).join(" ");
			const ok = await orchestrator.rejectTask(taskId, reason);
			if (ok) {
				console.log(chalk.yellow(`Worker task "${taskId}" rejected and isolated workspace cleaned up.`));
			} else {
				console.error(chalk.red(`Worker task "${taskId}" not found.`));
				process.exit(1);
			}
			return true;
		}

		default:
			return false;
	}
}
