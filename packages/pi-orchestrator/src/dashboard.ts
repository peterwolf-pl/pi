/**
 * Terminal Dashboard for PWPI Multi-Agent Orchestrator.
 * Renders an informative real-time terminal box showing:
 * - Multi-account quota tracking (5h and weekly limits with reset timers)
 * - Security Auditor status & findings
 * - Master & Worker agents state
 * - General coding tasks & delegated work
 */

import chalk from "chalk";
import type { OrchestratorStatus } from "./types.ts";

function renderProgressBar(pct?: number, width = 10): string {
	if (pct === undefined || Number.isNaN(pct)) {
		return chalk.dim(`[${"-".repeat(width)}] --%`);
	}
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	const empty = width - filled;

	let color = chalk.green;
	if (clamped < 20) {
		color = chalk.red.bold;
	} else if (clamped < 50) {
		color = chalk.yellow;
	}

	const bar = color("█".repeat(filled)) + chalk.dim("-".repeat(empty));
	const pctStr = `${clamped.toFixed(0)}%`.padStart(4);
	return `[${bar}] ${color(pctStr)}`;
}

export function renderDashboard(status: OrchestratorStatus, width = 78): string {
	const w = Math.max(70, Math.min(width, 100));
	const innerWidth = w - 2;

	const pad = (text: string, len: number) => {
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
			case "security_failed":
				return chalk.red.bgBlack.bold("SEC_FAILED");
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

	const formatRole = (role: string) => {
		switch (role.toLowerCase()) {
			case "master":
				return chalk.magenta.bold("MASTER");
			case "worker":
				return chalk.blue.bold("WORKER");
			case "security_auditor":
				return chalk.yellow.bold("AUDITOR");
			default:
				return chalk.dim("IDLE");
		}
	};

	const out: string[] = [];

	// Header
	out.push(topBorder());
	out.push(
		line(`${chalk.bold.cyan("PWPI MULTI-AGENT CODING ORCHESTRATOR")} ${chalk.dim("│ Antigravity & xAI & Security")}`),
	);
	out.push(separator());

	// ACCOUNTS & LIVE QUOTA MONITORING TABLE
	out.push(line(chalk.bold.underline("ACCOUNTS & REAL-TIME QUOTAS (5H / WEEKLY LIMITS)")));
	out.push(line(""));

	if (!status.accounts || status.accounts.length === 0) {
		out.push(line(chalk.dim("  No accounts discovered in ~/.pi/agent/auth.json")));
	} else {
		for (const acc of status.accounts) {
			const roleTag = formatRole(acc.role).padEnd(16);
			const label = acc.label ? `(${acc.label})` : "";
			const nameStr = `${acc.accountId} ${label}`.slice(0, 26).padEnd(26);

			let quotaLine = "";
			if (acc.provider === "xai") {
				quotaLine = `OAuth Token: ${chalk.green("Active")} (Reset: ${acc.fiveHourReset || "ready"})`;
			} else {
				const fiveHBar = renderProgressBar(acc.fiveHourRemaining, 8);
				const fiveHReset = acc.fiveHourReset ? chalk.dim(`(5h: ${acc.fiveHourReset})`) : "";
				const weeklyBar = renderProgressBar(acc.weeklyRemaining, 8);
				const weeklyReset = acc.weeklyReset ? chalk.dim(`(wk: ${acc.weeklyReset})`) : "";
				quotaLine = `5H ${fiveHBar} ${fiveHReset} │ WK ${weeklyBar} ${weeklyReset}`;
			}

			out.push(line(`  ${roleTag} ${chalk.white.bold(nameStr)}`));
			out.push(line(`     └─ ${quotaLine}`));
		}
	}

	out.push(separator());

	// SECURITY AUDITOR PANEL
	out.push(line(chalk.bold.underline("SECURITY AUDITOR INSPECTION")));
	out.push(line(""));

	const secEnabled = status.securityAuditEnabled;
	const auditorName = status.securityAuditor?.name || "none";
	const secStatusText = secEnabled
		? `${chalk.green.bold("ACTIVE")} ${chalk.dim(`(Assigned account: `)}${chalk.cyan.bold(auditorName)}${chalk.dim(`)`)}`
		: `${chalk.red.bold("DISABLED")} ${chalk.dim("(Changes merged without security scans)")}`;

	out.push(line(`  Status  : ${secStatusText}`));
	out.push(
		line(
			`  Checks  : ${chalk.yellow("Secrets / Keys Leakage")} │ ${chalk.yellow(
				"Shell Injection",
			)} │ ${chalk.yellow("OWASP & Permissions")}`,
		),
	);

	// Find any security audits from tasks
	const securityAuditedTasks = status.tasks.filter((t) => t.securityAudit);
	if (securityAuditedTasks.length > 0) {
		const latest = securityAuditedTasks[securityAuditedTasks.length - 1];
		const audit = latest.securityAudit!;
		const auditVerdict = audit.passed
			? chalk.green.bold("PASSED [CLEAN]")
			: chalk.red.bold(`FAILED [${audit.severity.toUpperCase()}]`);
		out.push(
			line(
				`  Latest  : Task ${chalk.bold(latest.task.task_id)} -> ${auditVerdict}: ${chalk.dim(
					audit.findings[0] || "",
				)}`,
			),
		);
	}

	out.push(separator());

	// GENERAL CODING MAIN TASK
	out.push(line(chalk.bold.underline("MAIN CODING OBJECTIVE")));
	out.push(line(""));
	const mainTitle = status.mainTask?.title || "Interactive General Coding Session";
	out.push(line(`  ${chalk.bold.green("▶")} ${chalk.bold.white(mainTitle)}`));
	out.push(
		line(
			`    Master (${chalk.magenta(status.master.name)}): ${chalk.dim(
				status.master.currentActivity || "Analyzing codebase / delegating work",
			)}`,
		),
	);

	out.push(separator());

	// DELEGATED SUBTASKS TABLE
	out.push(line(chalk.bold.underline("DELEGATED SUBTASKS & WORKTREE ISOLATION")));
	out.push(line(""));

	if (status.tasks.length === 0) {
		out.push(line(chalk.dim("  No subtasks delegated yet. Agenty czekają na zadania.")));
	} else {
		for (const rec of status.tasks.slice(-5)) {
			const id = chalk.bold(rec.task.task_id.padEnd(11));
			const agent = chalk.blue(rec.task.agent.slice(0, 16).padEnd(16));
			const title = rec.task.title.slice(0, 24).padEnd(25);
			const st = formatStatus(rec.status);
			out.push(line(`  ${id} ${agent} ${title} ${st}`));
			if (rec.result?.summary) {
				out.push(line(`     └─ ${chalk.dim(rec.result.summary.slice(0, 65))}`));
			}
		}
	}

	out.push(separator());

	// KEYBOARD SHORTCUTS LEGEND
	out.push(
		line(
			`${chalk.dim("[M]")} Master  ${chalk.dim("[W]")} Worker  ${chalk.dim(
				"[S]",
			)} Auditor  ${chalk.dim("[R]")} Quotas  ${chalk.dim("[D]")} Delegate  ${chalk.dim("[Q]")} Exit`,
		),
	);
	out.push(bottomBorder());

	return out.join("\n");
}
