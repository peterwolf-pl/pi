/**
 * Configuration manager for PWPI Multi-Agent AI Coding Orchestrator.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { CONFIG_DIR_NAME } from "../config.ts";
import type { OrchestratorConfig } from "./types.ts";

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
	agents: {
		master: "antigravity",
		worker: "antigravity2",
	},
	delegation: {
		enabled: true,
		automatic: true,
		max_workers: 1,
		default_timeout_ms: 300000, // 5 minutes
	},
	workspace: {
		isolated_workers: true,
	},
	review: {
		automatic_merge: false,
	},
};

export function getOrchestratorConfigPath(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		join(cwd, CONFIG_DIR_NAME, "orchestrator.yaml"),
		join(cwd, CONFIG_DIR_NAME, "orchestrator.yml"),
		join(cwd, CONFIG_DIR_NAME, "orchestrator.json"),
		// Fallbacks
		join(cwd, ".pwpi", "orchestrator.yaml"),
		join(cwd, ".pwpi", "orchestrator.json"),
		join(cwd, ".pi", "orchestrator.yaml"),
		join(cwd, ".pi", "orchestrator.json"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function loadOrchestratorConfig(cwd: string = process.cwd()): OrchestratorConfig {
	const configPath = getOrchestratorConfigPath(cwd);
	if (!configPath) {
		return { ...DEFAULT_ORCHESTRATOR_CONFIG };
	}

	try {
		const raw = readFileSync(configPath, "utf-8");
		let parsed: any;
		if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
			parsed = YAML.parse(raw);
		} else {
			parsed = JSON.parse(raw);
		}

		return {
			agents: {
				master: parsed?.agents?.master || DEFAULT_ORCHESTRATOR_CONFIG.agents.master,
				worker: parsed?.agents?.worker || DEFAULT_ORCHESTRATOR_CONFIG.agents.worker,
			},
			delegation: {
				enabled: parsed?.delegation?.enabled ?? DEFAULT_ORCHESTRATOR_CONFIG.delegation.enabled,
				automatic: parsed?.delegation?.automatic ?? DEFAULT_ORCHESTRATOR_CONFIG.delegation.automatic,
				max_workers: parsed?.delegation?.max_workers ?? DEFAULT_ORCHESTRATOR_CONFIG.delegation.max_workers,
				default_timeout_ms:
					parsed?.delegation?.default_timeout_ms ?? DEFAULT_ORCHESTRATOR_CONFIG.delegation.default_timeout_ms,
			},
			workspace: {
				isolated_workers:
					parsed?.workspace?.isolated_workers ?? DEFAULT_ORCHESTRATOR_CONFIG.workspace.isolated_workers,
				worktree_dir: parsed?.workspace?.worktree_dir,
			},
			review: {
				automatic_merge: parsed?.review?.automatic_merge ?? DEFAULT_ORCHESTRATOR_CONFIG.review.automatic_merge,
			},
		};
	} catch (error) {
		console.warn(`[Orchestrator] Warning: could not parse ${configPath}, using defaults: ${error}`);
		return { ...DEFAULT_ORCHESTRATOR_CONFIG };
	}
}

export function saveOrchestratorConfig(
	config: Partial<OrchestratorConfig>,
	cwd: string = process.cwd(),
	format: "yaml" | "json" = "json",
): string {
	const current = loadOrchestratorConfig(cwd);
	const merged: OrchestratorConfig = {
		agents: { ...current.agents, ...config.agents },
		delegation: { ...current.delegation, ...config.delegation },
		workspace: { ...current.workspace, ...config.workspace },
		review: { ...current.review, ...config.review },
	};

	const configDir = join(cwd, CONFIG_DIR_NAME);
	mkdirSync(configDir, { recursive: true });

	const filePath = join(configDir, `orchestrator.${format}`);
	const content = format === "yaml" ? YAML.stringify(merged) : JSON.stringify(merged, null, 2);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}
