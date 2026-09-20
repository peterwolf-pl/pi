/**
 * Interactive Real-Time Terminal Dashboard with Live Controls.
 * Runs in a single terminal window with instant keybindings to change settings,
 * switch master/worker accounts, toggle security auditor, and view live 5h/weekly quotas.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { renderDashboard } from "./dashboard.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { getDiscoveredAccounts } from "./quota.ts";

export async function runInteractiveDashboard(orchestrator: Orchestrator): Promise<void> {
	const isTTY = process.stdin.isTTY && process.stdout.isTTY;
	if (!isTTY) {
		const status = await orchestrator.getStatus(true);
		console.log(renderDashboard(status));
		return;
	}

	let running = true;
	let message = "";
	let isInputMode = false;
	let refreshInterval: NodeJS.Timeout | null = null;

	const clearScreen = () => {
		process.stdout.write("\x1b[2J\x1b[0;0H");
	};

	const redraw = async (forceQuota = false) => {
		if (!running || isInputMode) return;
		try {
			const status = await orchestrator.getStatus(forceQuota);
			clearScreen();
			const rendered = renderDashboard(status, Math.min(process.stdout.columns || 80, 95));
			process.stdout.write(`${rendered}\n`);
			if (message) {
				process.stdout.write(`\n${message}\n`);
			}
		} catch (err: any) {
			process.stdout.write(`Dashboard refresh error: ${err.message}\n`);
		}
	};

	const promptInput = async (query: string): Promise<string> => {
		isInputMode = true;
		if (process.stdin.isRaw) {
			process.stdin.setRawMode(false);
		}
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise<string>((resolve) => {
			rl.question(chalk.yellow.bold(`\n${query} `), (answer) => {
				rl.close();
				if (process.stdin.setRawMode) {
					process.stdin.setRawMode(true);
					process.stdin.resume();
				}
				isInputMode = false;
				resolve(answer.trim());
			});
		});
	};

	// Set terminal raw mode
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf-8");

	// Initial render
	message = chalk.cyan("Dashboard active. Press [H] for help, [Q] to quit.");
	await redraw(true);

	// Periodic auto-refresh every 4 seconds
	refreshInterval = setInterval(() => {
		void redraw(false);
	}, 4000);

	const handleKey = async (key: string) => {
		if (isInputMode) return;

		// Quit on q, Q, or Ctrl+C (\u0003)
		if (key === "q" || key === "Q" || key === "\u0003") {
			running = false;
			if (refreshInterval) clearInterval(refreshInterval);
			if (process.stdin.setRawMode) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
			clearScreen();
			console.log(chalk.green("Dashboard exited. PWPI Orchestrator running in background."));
			process.exit(0);
		}

		// R - Force refresh quotas
		if (key === "r" || key === "R") {
			message = chalk.yellow("Refreshing live quotas from Google & xAI...");
			await redraw(true);
			message = chalk.green("Quotas refreshed!");
			await redraw(false);
			return;
		}

		// S - Toggle Security Auditor or switch auditor account
		if (key === "s" || key === "S") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const currentAuditor = orchestrator.securityAuditor.getAuditorAccount();
			const isEnabled = orchestrator.securityAuditor.isEnabled();

			if (isEnabled) {
				// Cycle auditor account or turn off
				const nextIndex = (accounts.indexOf(currentAuditor) + 1) % (accounts.length + 1);
				if (nextIndex === accounts.length) {
					orchestrator.setSecurityAuditor(currentAuditor, false);
					message = chalk.red.bold("Security Auditor DISABLED.");
				} else {
					const nextAuditor = accounts[nextIndex];
					orchestrator.setSecurityAuditor(nextAuditor, true);
					message = chalk.green.bold(`Security Auditor assigned to: ${nextAuditor}`);
				}
			} else {
				orchestrator.setSecurityAuditor(currentAuditor, true);
				message = chalk.green.bold(`Security Auditor ENABLED (Auditor: ${currentAuditor})`);
			}
			await redraw(false);
			return;
		}

		// M - Switch Master Account
		if (key === "m" || key === "M") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const currentMaster = orchestrator.config.masterAccount;
			const currentIndex = accounts.indexOf(currentMaster);
			const nextIndex = (currentIndex + 1) % accounts.length;
			const nextMaster = accounts[nextIndex];

			orchestrator.setMasterAccount(nextMaster);
			message = chalk.magenta.bold(`Master account switched to: ${nextMaster}`);
			await redraw(false);
			return;
		}

		// W - Toggle Worker Accounts
		if (key === "w" || key === "W") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const activeWorkers = orchestrator.getActiveWorkers();
			// Find non-master accounts
			const nonMaster = accounts.filter((id) => id !== orchestrator.config.masterAccount);
			if (nonMaster.length === 0) {
				message = chalk.yellow("No other accounts available to toggle as workers.");
				await redraw(false);
				return;
			}
			// Toggle the next non-master account
			const inactive = nonMaster.find((id) => !activeWorkers.includes(id));
			if (inactive) {
				orchestrator.toggleWorkerAccount(inactive, true);
				message = chalk.blue.bold(`Worker activated: ${inactive}`);
			} else {
				// If all are active, toggle off the last one
				const toDisable = nonMaster[nonMaster.length - 1];
				orchestrator.toggleWorkerAccount(toDisable, false);
				message = chalk.yellow.bold(`Worker deactivated: ${toDisable}`);
			}
			await redraw(false);
			return;
		}

		// T - Set new main coding task
		if (key === "t" || key === "T") {
			if (refreshInterval) clearInterval(refreshInterval);
			const title = await promptInput("Enter main coding objective:");
			if (title) {
				orchestrator.setMainTask(title);
				message = chalk.green.bold(`Main task set: "${title}"`);
			}
			refreshInterval = setInterval(() => {
				void redraw(false);
			}, 4000);
			await redraw(false);
			return;
		}

		// D - Delegate subtask to worker
		if (key === "d" || key === "D") {
			if (refreshInterval) clearInterval(refreshInterval);
			const taskTitle = await promptInput("Enter subtask description to delegate:");
			if (taskTitle) {
				message = chalk.yellow(`Delegating subtask "${taskTitle}"...`);
				await redraw(false);
				try {
					const task = await orchestrator.createTask({
						title: taskTitle,
						description: taskTitle,
					});
					void orchestrator.runWorkerTask(task.task_id);
					message = chalk.green.bold(`Delegated ${task.task_id} to ${task.agent}!`);
				} catch (err: any) {
					message = chalk.red.bold(`Delegation failed: ${err.message}`);
				}
			}
			refreshInterval = setInterval(() => {
				void redraw(false);
			}, 4000);
			await redraw(false);
			return;
		}

		// H - Help
		if (key === "h" || key === "H") {
			message = chalk.cyan.bold(
				"Keys: [M] Switch Master │ [W] Toggle Worker │ [S] Toggle Security Auditor │ [R] Refresh Quota │ [T] Set Task │ [D] Delegate │ [Q] Quit",
			);
			await redraw(false);
		}
	};

	process.stdin.on("data", (data: Buffer | string) => {
		const str = data.toString();
		void handleKey(str);
	});
}
