/**
 * Core type definitions for PWPI Multi-Agent AI Coding Orchestrator.
 * Orchestrates Antigravity (Master) and Antigravity2 (Worker).
 */

export type AgentRole = "master" | "worker";

export type AgentState = "idle" | "running" | "waiting" | "reviewing" | "failed";

export type WorkerStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "blocked"
	| "needs_master_review"
	| "timeout";

export interface TaskTestResult {
	command?: string;
	status: "passed" | "failed" | "skipped";
	output?: string;
}

export interface WorkerTask {
	agent: string; // e.g. "antigravity2"
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
}

export interface OrchestratorConfig {
	agents: {
		master: string;
		worker: string;
	};
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
	};
}

export interface AgentInfo {
	name: string;
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
	tasks: WorkerTaskRecord[];
	agentsCount: number;
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
	| "agent_state_changed"
	| "main_task_updated";

export interface OrchestratorEvent {
	type: OrchestratorEventType;
	taskId?: string;
	agentName?: string;
	timestamp: number;
	data?: unknown;
}
