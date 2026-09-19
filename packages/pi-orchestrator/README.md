# Pi Antigravity Orchestrator (Multi-Agent Extension)

Multi-Agent AI Coding Orchestrator add-on for **Pi Coding Agent**.

Coordinates two independent AI agents:
* **`Antigravity`** - Primary / Master Agent (architecture, planning, review, integration, verification)
* **`Antigravity2`** - Secondary / Worker Agent (isolated investigations, API research, tests, diff generation)

## Installation

Install into your user configuration:
```bash
pi install /path/to/packages/pi-orchestrator
```

Or for project-local use:
```bash
pi install -l /path/to/packages/pi-orchestrator
```

## Features

- **Isolated Git Workspaces**: Worker tasks execute in isolated Git worktrees (`.pi/worktrees/<task_id>`).
- **File Ownership & Protection**: Master owns main files. Workers generate reviewable diffs/patches without directly modifying Master files.
- **Review & Approval Protocol**: Master inspects worker diffs and explicit approval is required to merge.
- **Fault Tolerance & Timeouts**: Worker errors or timeouts never crash the Master or Pi session.
- **Interactive Slash Commands**:
  - `/task <description>` - Set main goal for Antigravity
  - `/agents` - View agent status
  - `/workers` - List worker tasks
  - `/status` - Real-time terminal dashboard
  - `/delegate <task>` - Delegate isolated investigation to Antigravity2
  - `/diff <task_id>` - View git diff
  - `/approve <task_id>` - Merge changes
  - `/reject <task_id>` - Discard changes and clean up worktree
- **Built-in Tools for Master (Antigravity)**:
  - `delegate_task`
  - `check_worker_task`
  - `get_worker_diff`
  - `approve_worker_task`
  - `reject_worker_task`
  - `cancel_worker_task`
