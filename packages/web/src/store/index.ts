import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Task, Dependency, TaskStatus, EnergyLevel } from '@ordoflow/core';
import {
  INBOX_ID, createTask, findTaskById, findParentOf,
  updateTaskInTree, removeTaskFromTree, addSubtaskToTree,
  wouldCreateCycle,
} from '@ordoflow/core';
import type { ExportPayload, MergeResult } from '@ordoflow/core';
import {
  serializeState, serializeProject, extractProject,
  validateImport, mergeImport,
} from '@ordoflow/core';
import type { AIConfig } from '../ai';
import { PROVIDER_DEFAULTS } from '../ai';

export type SortMode = 'manual' | 'priority' | 'deadline' | 'duration' | 'energy';

function loadAIConfig(): AIConfig {
  try {
    const saved = localStorage.getItem('ordoflow-ai-config');
    if (saved) return JSON.parse(saved);
  } catch {}
  return { provider: 'openai', apiKey: '', baseUrl: PROVIDER_DEFAULTS.openai.baseUrl, model: PROVIDER_DEFAULTS.openai.model };
}

function createInbox(): Task {
  return { id: INBOX_ID, title: 'Inbox', status: 'pending', position: { x: 0, y: 0 }, priority: 0, subtasks: [], tags: [], createdAt: '' };
}

function createRoot(): Task {
  return { id: '__root__', title: 'Root', status: 'pending', position: { x: 0, y: 0 }, priority: 0, subtasks: [], tags: [], createdAt: '' };
}

interface OrdoFlowState {
  root: Task;
  inbox: Task;
  dependencies: Dependency[];
  currentView: 'board' | 'project';
  currentProjectId: string | null;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  viewMode: 'list' | 'graph';
  sortModes: Record<string, SortMode>;
  aiConfig: AIConfig;

  // Task ops
  addTopLevelTask: (title: string) => Task;
  addSubtask: (parentId: string, title: string, opts?: Partial<Task>) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  deleteSelectedTasks: () => void;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  selectTask: (id: string | null) => void;
  toggleTaskSelection: (id: string) => void;
  clearSelection: () => void;

  // Navigation
  goToBoard: () => void;
  goToProject: (id: string) => void;

  // View
  setViewMode: (mode: 'list' | 'graph') => void;
  setSortMode: (parentId: string, mode: SortMode) => void;

  // Deps
  addDependency: (fromId: string, toId: string) => boolean;
  deleteDependency: (id: string) => void;

  // AI
  setAIConfig: (config: Partial<AIConfig>) => void;

  // Data
  loadData: (data: { root?: Task; inbox?: Task; dependencies?: Dependency[] }) => void;

  // Import/Export
  importPreview: ExportPayload | null;
  startImport: (raw: string) => { valid: false; errors: string[] } | { valid: true };
  doImport: (mode: 'replace' | 'merge') => void;
  cancelImport: () => void;
  exportAll: () => void;
  exportProject: (projectId: string) => void;
}

export const useStore = create<OrdoFlowState>((set, get) => ({
  root: createRoot(),
  inbox: createInbox(),
  dependencies: [],
  currentView: 'board',
  currentProjectId: null,
  selectedTaskId: null,
  selectedTaskIds: new Set<string>(),
  viewMode: 'list',
  sortModes: {},
  aiConfig: loadAIConfig(),
  importPreview: null,

  addTopLevelTask: (title) => {
    const task = createTask(title, { id: nanoid() });
    set((state) => ({
      root: { ...state.root, subtasks: [...state.root.subtasks, task] },
    }));
    return task;
  },

  addSubtask: (parentId, title, opts) => {
    const task = createTask(title, { id: nanoid(), ...opts });
    set((state) => {
      // Check if parent is in inbox
      if (findTaskById(state.inbox, parentId)) {
        return { inbox: addSubtaskToTree(state.inbox, parentId, task) };
      }
      return { root: addSubtaskToTree(state.root, parentId, task) };
    });
    return task;
  },

  updateTask: (id, updates) => {
    if (id === INBOX_ID) return;
    set((state) => {
      // Check inbox
      if (findTaskById(state.inbox, id)) {
        return { inbox: updateTaskInTree(state.inbox, id, updates) };
      }
      return { root: updateTaskInTree(state.root, id, updates) };
    });
  },

  deleteTask: (id) => {
    if (id === INBOX_ID || id === '__root__') return;
    set((state) => {
      // Collect all descendant IDs recursively
      const allIds = new Set<string>();
      const collectIds = (task: Task) => {
        allIds.add(task.id);
        task.subtasks.forEach(collectIds);
      };

      // Find and collect from root or inbox
      let newRoot = state.root;
      let newInbox = state.inbox;

      const rootTask = findTaskById(state.root, id);
      if (rootTask) {
        collectIds(rootTask);
        newRoot = removeTaskFromTree(state.root, id);
      } else {
        const inboxTask = findTaskById(state.inbox, id);
        if (inboxTask) {
          collectIds(inboxTask);
          newInbox = removeTaskFromTree(state.inbox, id);
        }
      }

      return {
        root: newRoot,
        inbox: newInbox,
        dependencies: state.dependencies.filter(d => !allIds.has(d.fromTaskId) && !allIds.has(d.toTaskId)),
        selectedTaskId: allIds.has(state.selectedTaskId || '') ? null : state.selectedTaskId,
      };
    });
  },

  setTaskStatus: (id, status) => {
    get().updateTask(id, { status });
  },

  selectTask: (id) => set({ selectedTaskId: id }),

  toggleTaskSelection: (id) => {
    set((state) => {
      const next = new Set(state.selectedTaskIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedTaskIds: next };
    });
  },

  clearSelection: () => set({ selectedTaskIds: new Set() }),

  deleteSelectedTasks: () => {
    const { selectedTaskIds } = get();
    if (selectedTaskIds.size === 0) return;

    // Delete each selected task
    for (const id of selectedTaskIds) {
      get().deleteTask(id);
    }
    set({ selectedTaskIds: new Set() });
  },

  goToBoard: () => {
    window.history.pushState(null, '', '/');
    set({ currentView: 'board', currentProjectId: null, selectedTaskId: null });
  },

  goToProject: (id) => {
    window.history.pushState(null, '', `/project/${id}`);
    set({ currentView: 'project', currentProjectId: id, selectedTaskId: null, viewMode: 'list' });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSortMode: (parentId, mode) => {
    set((state) => ({ sortModes: { ...state.sortModes, [parentId]: mode } }));
  },

  addDependency: (fromId, toId) => {
    const { dependencies } = get();
    if (fromId === toId) return false;
    if (wouldCreateCycle(dependencies, fromId, toId)) return false;
    if (dependencies.some(d => d.fromTaskId === fromId && d.toTaskId === toId)) return false;
    set((state) => ({ dependencies: [...state.dependencies, { id: nanoid(), fromTaskId: fromId, toTaskId: toId }] }));
    return true;
  },

  deleteDependency: (id) => {
    set((state) => ({ dependencies: state.dependencies.filter(d => d.id !== id) }));
  },

  setAIConfig: (partial) => {
    set((state) => {
      const next = { ...state.aiConfig, ...partial };
      localStorage.setItem('ordoflow-ai-config', JSON.stringify(next));
      return { aiConfig: next };
    });
  },

  loadData: (data) => set({
    root: data.root || createRoot(),
    inbox: data.inbox || createInbox(),
    dependencies: data.dependencies || [],
  }),

  startImport: (raw) => {
    const result = validateImport(raw);
    if (!result.valid) return result;
    set({ importPreview: result.data });
    return { valid: true as const };
  },

  doImport: (mode) => {
    const { root, inbox, dependencies, importPreview } = get();
    if (!importPreview) return;

    if (mode === 'replace') {
      // Auto-backup before replacing
      try {
        const backup = serializeState(root, inbox, dependencies);
        const blob = new Blob([backup], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ordoflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {}

      set({
        root: importPreview.data.root,
        inbox: importPreview.data.inbox,
        dependencies: importPreview.data.dependencies,
        importPreview: null,
        currentView: 'board',
        currentProjectId: null,
        selectedTaskId: null,
      });
    } else {
      const result = mergeImport(root, inbox, dependencies, importPreview);
      set({
        root: result.root,
        inbox: result.inbox,
        dependencies: result.dependencies,
        importPreview: null,
      });
      window.dispatchEvent(new CustomEvent('ordoflow-toast', {
        detail: {
          message: `Imported. Skipped ${result.skipped} duplicates, ${result.cycleSkips} cycles.`,
          type: 'info',
        },
      }));
    }
  },

  cancelImport: () => set({ importPreview: null }),

  exportAll: () => {
    const { root, inbox, dependencies } = get();
    const json = serializeState(root, inbox, dependencies);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ordoflow-all-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  exportProject: (projectId) => {
    const { root, dependencies } = get();
    const json = serializeProject(root, projectId, dependencies);
    if (!json) return;
    const project = extractProject(root, projectId);
    const name = project?.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ordoflow-${name}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
}));
