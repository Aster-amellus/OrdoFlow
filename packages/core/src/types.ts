export type TaskStatus = 'pending' | 'in_progress' | 'done';
export type EnergyLevel = 'high' | 'medium' | 'low';

export const INBOX_ID = '__inbox__';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  estimatedMinutes?: number;
  deadline?: string;
  energyLevel?: EnergyLevel;
  priority: number;
  position: { x: number; y: number };
  subtasks: Task[];
  tags: string[];
  sourceVagueTask?: string;
  createdAt: string;
}

export interface Dependency {
  id: string;
  fromTaskId: string;
  toTaskId: string;
}

export function createTask(title: string, opts?: Partial<Task>): Task {
  return {
    id: opts?.id || '',
    title,
    status: 'pending',
    position: opts?.position || { x: 0, y: 0 },
    priority: opts?.priority ?? 2,
    subtasks: [],
    tags: [],
    createdAt: new Date().toISOString(),
    ...opts,
  };
}

export function isInbox(task: Task): boolean {
  return task.id === INBOX_ID;
}

export function isProject(task: Task): boolean {
  return task.subtasks.length > 0;
}

export function countRemaining(task: Task): number {
  if (task.subtasks.length === 0) {
    return task.status === 'done' ? 0 : 1;
  }
  return task.subtasks.reduce((sum, child) => sum + countRemaining(child), 0);
}

export function countTotal(task: Task): number {
  if (task.subtasks.length === 0) return 1;
  return task.subtasks.reduce((sum, child) => sum + countTotal(child), 0);
}

export function findTaskById(root: Task, id: string): Task | null {
  if (root.id === id) return root;
  for (const child of root.subtasks) {
    const found = findTaskById(child, id);
    if (found) return found;
  }
  return null;
}

export function findParentOf(root: Task, childId: string): Task | null {
  for (const child of root.subtasks) {
    if (child.id === childId) return root;
    const found = findParentOf(child, childId);
    if (found) return found;
  }
  return null;
}

export function updateTaskInTree(root: Task, id: string, updates: Partial<Task>): Task {
  if (root.id === id) return { ...root, ...updates };
  return {
    ...root,
    subtasks: root.subtasks.map(child => updateTaskInTree(child, id, updates)),
  };
}

export function removeTaskFromTree(root: Task, id: string): Task {
  return {
    ...root,
    subtasks: root.subtasks
      .filter(child => child.id !== id)
      .map(child => removeTaskFromTree(child, id)),
  };
}

export function addSubtaskToTree(root: Task, parentId: string, subtask: Task): Task {
  if (root.id === parentId) {
    return { ...root, subtasks: [...root.subtasks, subtask] };
  }
  return {
    ...root,
    subtasks: root.subtasks.map(child => addSubtaskToTree(child, parentId, subtask)),
  };
}
