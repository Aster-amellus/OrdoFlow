import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Task, Dependency, TaskStatus } from '@ordoflow/core';
import {
  INBOX_ID, ROOT_ID, createTask, createInbox, createRoot, findTaskById,
  updateTaskInTree, removeTaskFromTree, addSubtaskToTree,
  canAddDependency,
} from '@ordoflow/core';
import type { ExportPayload } from '@ordoflow/core';
import {
  serializeState, serializeProject, extractProject,
  validateImport, mergeImport,
} from '@ordoflow/core';
import type { AIConfig } from '../ai';
import {
  downloadTextFile,
  loadAIConfig,
  loadWorkspaceMemory,
  pushRoute,
  saveAIConfig,
  saveWorkspaceMemory,
  showToast,
  type RouteState,
} from '../browser';

export type SortMode = 'manual' | 'priority' | 'deadline' | 'duration' | 'energy';

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
  workspaceMemory: string;

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
  syncRoute: (route: RouteState) => void;

  // View
  setViewMode: (mode: 'list' | 'graph') => void;
  setSortMode: (parentId: string, mode: SortMode) => void;

  // Deps
  addDependency: (fromId: string, toId: string) => boolean;
  deleteDependency: (id: string) => void;

  // AI
  setAIConfig: (config: Partial<AIConfig>) => void;
  setWorkspaceMemory: (memory: string) => void;

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
  workspaceMemory: loadWorkspaceMemory(),
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
    if (id === INBOX_ID || id === ROOT_ID) return;
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
    pushRoute({ view: 'board', projectId: null });
    set({ currentView: 'board', currentProjectId: null, selectedTaskId: null });
  },

  goToProject: (id) => {
    pushRoute({ view: 'project', projectId: id });
    set({ currentView: 'project', currentProjectId: id, selectedTaskId: null, viewMode: 'list' });
  },

  syncRoute: (route) => {
    if (route.view === 'project') {
      set({ currentView: 'project', currentProjectId: route.projectId, selectedTaskId: null });
    } else {
      set({ currentView: 'board', currentProjectId: null, selectedTaskId: null });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSortMode: (parentId, mode) => {
    set((state) => ({ sortModes: { ...state.sortModes, [parentId]: mode } }));
  },

  addDependency: (fromId, toId) => {
    const { dependencies, root, inbox } = get();
    const check = canAddDependency(dependencies, fromId, toId, { root, inbox });
    if (!check.ok) return false;
    set((state) => ({ dependencies: [...state.dependencies, { id: nanoid(), fromTaskId: fromId, toTaskId: toId }] }));
    return true;
  },

  deleteDependency: (id) => {
    set((state) => ({ dependencies: state.dependencies.filter(d => d.id !== id) }));
  },

  setAIConfig: (partial) => {
    set((state) => {
      const next = { ...state.aiConfig, ...partial };
      saveAIConfig(next);
      return { aiConfig: next };
    });
  },

  setWorkspaceMemory: (memory) => {
    saveWorkspaceMemory(memory);
    set({ workspaceMemory: memory });
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
        downloadTextFile(`ordoflow-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
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
      showToast(`Imported. Skipped ${result.skipped} duplicates, ${result.cycleSkips} cycles.`);
    }
  },

  cancelImport: () => set({ importPreview: null }),

  exportAll: () => {
    const { root, inbox, dependencies } = get();
    const json = serializeState(root, inbox, dependencies);
    downloadTextFile(`ordoflow-all-${new Date().toISOString().slice(0, 10)}.json`, json);
  },

  exportProject: (projectId) => {
    const { root, dependencies } = get();
    const json = serializeProject(root, projectId, dependencies);
    if (!json) return;
    const project = extractProject(root, projectId);
    const name = project?.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    downloadTextFile(`ordoflow-${name}-${new Date().toISOString().slice(0, 10)}.json`, json);
  },
}));
