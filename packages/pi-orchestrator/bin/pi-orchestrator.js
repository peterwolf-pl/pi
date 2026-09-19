#!/usr/bin/env node
import { handleOrchestratorCommand } from "../src/cli.ts";

const rawArgs = process.argv.slice(2);
const args = rawArgs.length === 0 ? ["worker", "status"] : rawArgs;

const handled = await handleOrchestratorCommand(args);
if (!handled) {
	console.log(`Pi Antigravity Multi-Agent Orchestrator

Usage:
  pi-orchestrator task "<title>"            Set main task for Antigravity (Master Agent)
  pi-orchestrator agents                    Show configured agents (Antigravity & Antigravity2)
  pi-orchestrator workers                   List worker tasks assigned to Antigravity2
  pi-orchestrator delegate "<description>"  Delegate an isolated task to Antigravity2
  pi-orchestrator worker status             Show multi-agent real-time dashboard
  pi-orchestrator worker logs [task_id]     View worker logs
  pi-orchestrator diff <task_id>            View diff produced by Antigravity2
  pi-orchestrator approve <task_id>         Approve and merge worker changes into master
  pi-orchestrator reject <task_id>          Reject worker changes and clean workspace
`);
}
