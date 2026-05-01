# OrdoFlow

A recursive task manager. Tasks contain subtasks. Sort siblings. Visualize as graph.

## How It Works

1. **Tasks are trees** — a Task can contain subtasks, which can contain subtasks. No separate Project/Folder entities.
2. **Inbox** — a special root for small/trivial tasks. No dependencies allowed.
3. **Projects** — any Task with subtasks is a project. Top-level tasks are projects.
4. **Global board** — shows Inbox + all top-level projects with remaining task counts.
5. **Graph view** — select a project, see its direct subtasks as nodes with dependencies.
6. **Sort** — always sort siblings (direct children of the same parent). By priority, deadline, duration, or drag.
7. **AI** — breaks down a goal into subtasks. Asks about granularity and project placement first.

## Quick Start

```bash
pnpm install
cd packages/web
pnpm dev
```
