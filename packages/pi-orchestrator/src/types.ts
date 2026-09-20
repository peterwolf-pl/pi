/**
 * Core type definitions for PWPI Multi-Agent AI Coding Orchestrator.
 * Orchestrates Master, Multiple Workers (Antigravity & xAI), and Security Auditor.
 */

export type AgentRole = "master" | "worker" | "security_auditor" | "idle";

export type AgentState = "idle" | "running" | "waiting" | "reviewing" | "auditing" | "failed";

export type WorkerStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "blocked"
	| "needs_master_review"
	| "needs_security_audit"
	| "security_failed"
	| "timeout";

export interface TaskTestResult {
	command?: string;
	status: "passed" | "failed" | "skipped";
	output?: string;
}

export interface SecurityAuditResult {
	passed: boolean;
	severity: "clean" | "low" | "medium" | "high" | "critical";
	findings: string[];
	recommendations: string[];
	auditedBy: string; // accountId
	auditedAt: number;
}

export interface WorkerTask {
	agent: string; // e.g. "google-antigravity-2" or "xai"
	task_id: string; // e.g. "worker-001"
	title: string;
	description: string;
	scope?: string[];
	allowed_files?: string[];
	run_tests?: boolean;
	test_command?: string;
	timeout_ms?: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

export interface TaskResult {
	task_id: string;
	status: WorkerStatus;
	summary: string;
	findings?: string;
	files_changed: string[];
	tests?: TaskTestResult;
	securityAudit?: SecurityAuditResult;
	problems?: string;
	recommendation?: string;
	patch_available?: boolean;
	patch?: string;
	raw_output?: string;
	error?: string;
}

export interface WorkerTaskRecord {
	task: WorkerTask;
	status: WorkerStatus;
	result?: TaskResult;
	diff?: string;
	workspacePath?: string;
	error?: string;
	securityAudit?: SecurityAuditResult;
}

export interface QuotaBucketInfo {
	displayName: string;
	window?: string; // "5h", "weekly", etc.
	remainingFraction: number; // 0..1
	resetTime?: string;
	resetFormatted: string; // e.g. "2h 15m", "5d 14h", "now"
}

export interface AccountLimits {
	accountId: string; // "antigravity", "google-antigravity-2", "google-antigravity-3", "xai"
	provider: "antigravity" | "xai" | "google" | "other";
	label?: string; // "liam", "3", etc.
	planLabel?: string; // "Google AI Pro (g1-pro-tier)"
	role: AgentRole;
	enabled: boolean;
	isMaster: boolean;
	isSecurityAuditor: boolean;
	fiveHourRemaining?: number; // percentage 0..100
	weeklyRemaining?: number; // percentage 0..100
	fiveHourReset?: string;
	weeklyReset?: string;
	modelsQuota?: Array<{
		modelId: string;
		remainingFraction: number;
		resetTime?: string;
		resetFormatted: string;
	}>;
	lastUpdated?: number;
	status: "active" | "cooling_down" | "rate_limited" | "error" | "ready";
	error?: string;
}

export interface AccountConfig {
	id: string;
	role: AgentRole;
	enabled: boolean;
	label?: string;
	provider: string;
}

export interface OrchestratorConfig {
	masterAccount: string; // default "antigravity"
	securityAuditorAccount: string; // default "xai" or "google-antigravity-3"
	securityAuditorEnabled: boolean; // toggle whether security audit is active
	activeWorkers: string[]; // which accounts participate as workers
	accounts: Record<string, AccountConfig>;
	delegation: {
		enabled: boolean;
		automatic: boolean;
		max_workers: number;
		default_timeout_ms: number;
	};
	workspace: {
		isolated_workers: boolean;
		worktree_dir?: string;
	};
	review: {
		automatic_merge: boolean;
		require_security_approval: boolean;
	};
}

export interface AgentInfo {
	name: string;
	accountId: string;
	role: AgentRole;
	status: AgentState;
	currentActivity?: string;
	subtasks: string[];
}

export interface MainTaskInfo {
	title: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed";
}

export interface OrchestratorStatus {
	mainTask?: MainTaskInfo;
	master: AgentInfo;
	workers: AgentInfo[];
	securityAuditor?: AgentInfo;
	tasks: WorkerTaskRecord[];
	agentsCount: number;
	accounts: AccountLimits[];
	securityAuditEnabled: boolean;
}

export type OrchestratorEventType =
	| "task_created"
	| "task_started"
	| "task_completed"
	| "task_failed"
	| "task_cancelled"
	| "task_timeout"
	| "task_approved"
	| "task_rejected"
	| "security_audit_started"
	| "security_audit_completed"
	| "agent_state_changed"
	| "account_switched"
	| "quota_updated"
	| "main_task_updated";

export interface OrchestratorEvent {
	type: OrchestratorEventType;
	taskId?: string;
	agentName?: string;
	accountId?: string;
	timestamp: number;
	data?: unknown;
}
