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
import type { AIConfig, NormalizedAIProjectPatchResponse } from '../ai';
import {
  downloadTextFile,
  loadAIConfig,
  loadPlanningMethod,
  loadWorkspaceMemory,
  pushRoute,
  saveAIConfig,
  savePlanningMethod,
  saveWorkspaceMemory,
  showToast,
  type RouteState,
} from '../browser';

export type SortMode = 'manual' | 'priority' | 'deadline' | 'duration' | 'energy';

export interface PatchApplyResult {
  inserted: number;
  updated: number;
  deleted: number;
  moved: number;
  addedDeps: number;
  removedDeps: number;
  skippedOps: number;
}

function collectIds(task: Task, ids: Set<string>): void {
  ids.add(task.id);
  task.subtasks.forEach(child => collectIds(child, ids));
}

function insertSubtaskAt(root: Task, parentId: string, subtask: Task, afterId?: string): Task {
  if (root.id === parentId) {
    const nextSubtasks = [...root.subtasks];
    const index = afterId ? nextSubtasks.findIndex(child => child.id === afterId) : -1;
    if (index >= 0) nextSubtasks.splice(index + 1, 0, subtask);
    else nextSubtasks.push(subtask);
    return { ...root, subtasks: nextSubtasks };
  }
  return {
    ...root,
    subtasks: root.subtasks.map(child => insertSubtaskAt(child, parentId, subtask, afterId)),
  };
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
  workspaceMemory: string;
  planningMethod: string;

  // Task ops
  addTopLevelTask: (title: string) => Task;
  addSubtask: (parentId: string, title: string, opts?: Partial<Task>) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  deleteSelectedTasks: () => void;
  replaceProjectPlan: (
    projectId: string,
    subtasks: Task[],
    projectDeps: Dependency[],
    projectUpdates?: Partial<Task>
  ) => { addedDeps: number; skippedDeps: number } | null;
  applyProjectPatch: (
    projectId: string,
    patch: NormalizedAIProjectPatchResponse
  ) => PatchApplyResult | null;
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
  setPlanningMethod: (method: string) => void;

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
  planningMethod: loadPlanningMethod(),
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

  replaceProjectPlan: (projectId, subtasks, projectDeps, projectUpdates) => {
    const state = get();
    const project = findTaskById(state.root, projectId);
    if (!project || project.id === ROOT_ID || project.id === INBOX_ID) return null;

    const oldChildIds = new Set<string>();
    const collectIds = (task: Task) => {
      oldChildIds.add(task.id);
      task.subtasks.forEach(collectIds);
    };
    project.subtasks.forEach(collectIds);

    const nextRoot = updateTaskInTree(state.root, projectId, {
      ...projectUpdates,
      subtasks,
    });

    const nextDeps = state.dependencies.filter(
      dep => !oldChildIds.has(dep.fromTaskId) && !oldChildIds.has(dep.toTaskId)
    );

    let addedDeps = 0;
    let skippedDeps = 0;
    for (const dep of projectDeps) {
      const check = canAddDependency(nextDeps, dep.fromTaskId, dep.toTaskId, {
        root: nextRoot,
        inbox: state.inbox,
      });
      if (!check.ok) {
        skippedDeps++;
        continue;
      }
      nextDeps.push(dep);
      addedDeps++;
    }

    set({
      root: nextRoot,
      dependencies: nextDeps,
      selectedTaskId: oldChildIds.has(state.selectedTaskId || '') ? projectId : state.selectedTaskId,
      selectedTaskIds: new Set(),
    });

    return { addedDeps, skippedDeps };
  },

  applyProjectPatch: (projectId, patch) => {
    const state = get();
    if (projectId === ROOT_ID || projectId === INBOX_ID) return null;
    if (!findTaskById(state.root, projectId)) return null;

    let nextRoot = state.root;
    let nextDeps = [...state.dependencies];
    const insertedKeys = new Map<string, string>();
    const result: PatchApplyResult = {
      inserted: 0,
      updated: 0,
      deleted: 0,
      moved: 0,
      addedDeps: 0,
      removedDeps: 0,
      skippedOps: 0,
    };

    const resolveRef = (ref: string | null | undefined): string | undefined => {
      if (!ref) return undefined;
      return insertedKeys.get(ref) || ref;
    };

    const currentProject = () => findTaskById(nextRoot, projectId);
    const currentProjectIds = () => {
      const ids = new Set<string>();
      const project = currentProject();
      if (project) collectIds(project, ids);
      return ids;
    };
    const isEditableTask = (id: string | undefined) => {
      if (!id || id === projectId) return false;
      return currentProjectIds().has(id);
    };
    const isEditableParent = (id: string | undefined) => {
      if (!id) return false;
      return currentProjectIds().has(id);
    };

    const projectUpdates: Partial<Task> = {};
    if (patch.projectTitle) projectUpdates.title = patch.projectTitle;
    if (patch.projectDescription) projectUpdates.description = patch.projectDescription;
    if (Object.keys(projectUpdates).length > 0) {
      nextRoot = updateTaskInTree(nextRoot, projectId, projectUpdates);
      result.updated++;
    }

    for (const op of patch.taskOperations) {
      if (op.type === 'insert') {
        const parentId = resolveRef(op.parentId);
        const afterId = resolveRef(op.afterId);
        if (!parentId || insertedKeys.has(op.key) || !isEditableParent(parentId)) {
          result.skippedOps++;
          continue;
        }

        const task = createTask(op.title, {
          id: nanoid(),
          description: op.description,
          estimatedMinutes: op.estimatedMinutes,
          energyLevel: op.energyLevel,
        });
        nextRoot = insertSubtaskAt(nextRoot, parentId, task, afterId);
        insertedKeys.set(op.key, task.id);
        result.inserted++;
      } else if (op.type === 'update') {
        const targetId = resolveRef(op.targetId);
        if (!isEditableTask(targetId)) {
          result.skippedOps++;
          continue;
        }

        const updates: Partial<Task> = {};
        if (op.title) updates.title = op.title;
        if (op.description) updates.description = op.description;
        if (op.estimatedMinutes) updates.estimatedMinutes = op.estimatedMinutes;
        if (op.energyLevel) updates.energyLevel = op.energyLevel;
        if (Object.keys(updates).length === 0) {
          result.skippedOps++;
          continue;
        }
        nextRoot = updateTaskInTree(nextRoot, targetId!, updates);
        result.updated++;
      } else if (op.type === 'delete') {
        const targetId = resolveRef(op.targetId);
        if (!isEditableTask(targetId)) {
          result.skippedOps++;
          continue;
        }

        const target = findTaskById(nextRoot, targetId!);
        if (!target) {
          result.skippedOps++;
          continue;
        }
        const deletedIds = new Set<string>();
        collectIds(target, deletedIds);
        nextRoot = removeTaskFromTree(nextRoot, targetId!);
        nextDeps = nextDeps.filter(dep => !deletedIds.has(dep.fromTaskId) && !deletedIds.has(dep.toTaskId));
        for (const [key, id] of insertedKeys) {
          if (deletedIds.has(id)) insertedKeys.delete(key);
        }
        result.deleted++;
      } else if (op.type === 'move') {
        const targetId = resolveRef(op.targetId);
        const parentId = resolveRef(op.parentId);
        let afterId = resolveRef(op.afterId);
        if (!isEditableTask(targetId) || !isEditableParent(parentId) || targetId === parentId) {
          result.skippedOps++;
          continue;
        }

        const target = findTaskById(nextRoot, targetId!);
        if (!target) {
          result.skippedOps++;
          continue;
        }
        const targetIds = new Set<string>();
        collectIds(target, targetIds);
        if (targetIds.has(parentId!) || targetId === afterId || (afterId && targetIds.has(afterId))) {
          result.skippedOps++;
          continue;
        }
        if (afterId && !currentProjectIds().has(afterId)) afterId = undefined;
        nextRoot = removeTaskFromTree(nextRoot, targetId!);
        nextRoot = insertSubtaskAt(nextRoot, parentId!, target, afterId);
        result.moved++;
      }
    }

    for (const op of patch.dependencyOperations) {
      const fromId = resolveRef(op.fromId);
      const toId = resolveRef(op.toId);
      if (!fromId || !toId || fromId === toId) {
        result.skippedOps++;
        continue;
      }

      if (op.type === 'remove') {
        const before = nextDeps.length;
        nextDeps = nextDeps.filter(dep => dep.fromTaskId !== fromId || dep.toTaskId !== toId);
        if (nextDeps.length < before) result.removedDeps++;
        else result.skippedOps++;
      } else {
        const check = canAddDependency(nextDeps, fromId, toId, { root: nextRoot, inbox: state.inbox });
        if (!check.ok) {
          result.skippedOps++;
          continue;
        }
        nextDeps.push({ id: nanoid(), fromTaskId: fromId, toTaskId: toId });
        result.addedDeps++;
      }
    }

    set({
      root: nextRoot,
      dependencies: nextDeps,
      selectedTaskIds: new Set(),
      selectedTaskId: state.selectedTaskId && findTaskById(nextRoot, state.selectedTaskId) ? state.selectedTaskId : null,
    });

    return result;
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

  setPlanningMethod: (method) => {
    savePlanningMethod(method);
    set({ planningMethod: method });
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
