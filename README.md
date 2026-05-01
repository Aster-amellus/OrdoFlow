# OrdoFlow

A recursive dependency-aware task manager. Tasks contain subtasks, sort siblings, visualize as graph.

## Concepts

- **Task** — the only entity. Has `subtasks: Task[]` (recursive). Can be a leaf task or a project (has children).
- **Inbox** (`/`) — flat list for small/trivial tasks. No dependencies between inbox items.
- **Project** — any task with subtasks. Click its name to enter, click ✎ to edit details.
- **Dependency** — A → B means B is blocked until A is done. Drawn as edges on the graph, visible as 🔒 in list.
- **Layer** — topological sort groups siblings into layers. Layer 0 = no blockers, Layer 1 = blocked by Layer 0, etc.
- **Priority** — 0 (pinned), 1 (high), 2 (medium), 3 (low). Float part (1.x) set by drag-order within a layer.

## Views

| View | URL | Description |
|------|-----|-------------|
| Board | `/` | Inbox + project list with task counts |
| List | `/project/<id>` | Layer-grouped list, per-task locking, sort dropdown |
| Graph | `/project/<id>` | Auto-layout horizontal flow. Double-click pane to add node. Drag nodes freely. |

Toggle List/Graph in the toolbar. Browser back/forward navigates between board and projects.

## Quick Start

```bash
pnpm install
cd packages/web
pnpm dev
```

## Architecture

```
packages/
├── core/                    @ordoflow/core
│   └── src/
│       ├── types.ts         Task (recursive), Dependency, tree helpers
│       ├── topology.ts      getLayers, sortSiblings, wouldCreateCycle
│       ├── critical-path.ts calculateCriticalPath
│       ├── progress.ts      calculateProgress, formatTimeRemaining
│       └── index.ts
│
└── web/                     @ordoflow/web
    └── src/
        ├── store/index.ts   Zustand: tree CRUD, dependencies, batch delete, URL sync
        ├── ai.ts            Multi-provider AI client (OpenAI/Anthropic/DeepSeek/Custom)
        ├── components/
        │   ├── Board.tsx         Global board (Inbox + projects)
        │   ├── TaskList.tsx      Layer-grouped list view (per-project)
        │   ├── TaskItem.tsx      Task card with progress bar, selection checkbox
        │   ├── LayerSection.tsx  Layer header with sort dropdown
        │   ├── Canvas.tsx        React Flow graph with auto-layout
        │   ├── TaskNode.tsx      Graph node component
        │   ├── DetailPanel.tsx   Task editor (subtasks, deps, properties)
        │   ├── Toolbar.tsx       AI input, view toggle, settings modal
        │   ├── QuickAdd.tsx      Quick-add input (press / to focus)
        │   └── Toast.tsx         Toast notifications
        └── App.tsx
```

## Stack

- React 18 + Vite + TypeScript
- Zustand (state management)
- React Flow v12 (graph visualization)
- Tailwind CSS (styling)
- nanoid (task IDs)
- OpenAI / Anthropic / DeepSeek API (optional, for AI breakdown)

## Features

- **Task tree** — unlimited nesting via `subtasks`. Click any parent to drill down.
- **Dependencies** — drag handles on graph or use dropdown in detail panel. Cycle detection prevents invalid edges.
- **Per-task locking** — checkbox disabled until all dependencies are done.
- **Batch delete** — toggle selection mode, multi-select with Ctrl/Cmd, bulk delete.
- **AI breakdown** — 2-step flow: choose target project + granularity, then generate.
- **Browser navigation** — URLs sync with state (`/` for board, `/project/<id>` for projects). Back/forward works.
- **localStorage persistence** — all data auto-saved on every change.
- **19 unit tests** — core topology engine, tree operations, progress calculation.
