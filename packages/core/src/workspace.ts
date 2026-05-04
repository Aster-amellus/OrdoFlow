import type { Dependency, Task, WorkspaceData } from './types';
import { INBOX_ID, ROOT_ID, findParentOf } from './types';
import { wouldCreateCycle } from './topology';

export type DependencyCheckReason =
  | 'self'
  | 'duplicate'
  | 'cycle'
  | 'missing_task'
  | 'inbox';

export type DependencyCheckResult =
  | { ok: true }
  | { ok: false; reason: DependencyCheckReason };

export interface WorkspaceValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTask(task: unknown, path: string, ids: Set<string>, errors: string[]): task is Task {
  if (!isRecord(task)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  const id = task.id;
  if (typeof id !== 'string' || id.length === 0) {
    errors.push(`${path}.id must be a non-empty string`);
  } else if (ids.has(id)) {
    errors.push(`Duplicate task id "${id}"`);
  } else {
    ids.add(id);
  }

  if (typeof task.title !== 'string') errors.push(`${path}.title must be a string`);
  if (!['pending', 'in_progress', 'done'].includes(task.status as string)) {
    errors.push(`${path}.status is invalid`);
  }

  if (!isRecord(task.position)) {
    errors.push(`${path}.position must be an object`);
  } else {
    if (typeof task.position.x !== 'number') errors.push(`${path}.position.x must be a number`);
    if (typeof task.position.y !== 'number') errors.push(`${path}.position.y must be a number`);
  }

  if (typeof task.priority !== 'number') errors.push(`${path}.priority must be a number`);
  if (!Array.isArray(task.subtasks)) errors.push(`${path}.subtasks must be an array`);
  if (!Array.isArray(task.tags)) errors.push(`${path}.tags must be an array`);
  if (task.estimatedMinutes !== undefined && typeof task.estimatedMinutes !== 'number') {
    errors.push(`${path}.estimatedMinutes must be a number when present`);
  }
  if (task.deadline !== undefined && typeof task.deadline !== 'string') {
    errors.push(`${path}.deadline must be a string when present`);
  }
  if (
    task.energyLevel !== undefined &&
    !['high', 'medium', 'low'].includes(task.energyLevel as string)
  ) {
    errors.push(`${path}.energyLevel is invalid`);
  }

  if (Array.isArray(task.subtasks)) {
    task.subtasks.forEach((child, index) => validateTask(child, `${path}.subtasks[${index}]`, ids, errors));
  }

  return errors.length === 0;
}

export function validateWorkspaceData(data: unknown): WorkspaceValidationResult {
  const errors: string[] = [];
  if (!isRecord(data)) return { valid: false, errors: ['Workspace data must be an object'] };

  const ids = new Set<string>();
  validateTask(data.root, 'data.root', ids, errors);
  validateTask(data.inbox, 'data.inbox', ids, errors);

  const root = data.root as Task | undefined;
  const inbox = data.inbox as Task | undefined;
  if (root && root.id !== ROOT_ID) errors.push(`data.root.id must be "${ROOT_ID}"`);
  if (inbox && inbox.id !== INBOX_ID) errors.push(`data.inbox.id must be "${INBOX_ID}"`);

  const dependencies = data.dependencies;
  if (!Array.isArray(dependencies)) {
    errors.push('data.dependencies must be an array');
  } else {
    const depKeys = new Set<string>();
    dependencies.forEach((dep, index) => {
      const path = `data.dependencies[${index}]`;
      if (!isRecord(dep)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof dep.id !== 'string' || dep.id.length === 0) {
        errors.push(`${path}.id must be a non-empty string`);
      }
      if (typeof dep.fromTaskId !== 'string' || typeof dep.toTaskId !== 'string') {
        errors.push(`${path} endpoints must be strings`);
        return;
      }
      if (!ids.has(dep.fromTaskId)) errors.push(`${path}.fromTaskId points to a missing task`);
      if (!ids.has(dep.toTaskId)) errors.push(`${path}.toTaskId points to a missing task`);

      const key = `${dep.fromTaskId}->${dep.toTaskId}`;
      if (depKeys.has(key)) errors.push(`${path} duplicates another dependency`);
      depKeys.add(key);
    });
  }

  if (errors.length === 0 && Array.isArray(dependencies)) {
    const acceptedDeps: Dependency[] = [];
    dependencies.forEach((dep, index) => {
      const check = canAddDependency(acceptedDeps, dep.fromTaskId, dep.toTaskId, {
        root: data.root as Task,
        inbox: data.inbox as Task,
      });
      if (!check.ok) {
        errors.push(`data.dependencies[${index}] is invalid: ${check.reason}`);
      } else {
        acceptedDeps.push(dep);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function canAddDependency(
  dependencies: Dependency[],
  fromId: string,
  toId: string,
  workspace?: Pick<WorkspaceData, 'root' | 'inbox'>
): DependencyCheckResult {
  if (fromId === toId) return { ok: false, reason: 'self' };
  if (dependencies.some(d => d.fromTaskId === fromId && d.toTaskId === toId)) {
    return { ok: false, reason: 'duplicate' };
  }

  if (workspace) {
    const fromParent = findParentOf(workspace.root, fromId) || findParentOf(workspace.inbox, fromId);
    const toParent = findParentOf(workspace.root, toId) || findParentOf(workspace.inbox, toId);
    if (!fromParent || !toParent) return { ok: false, reason: 'missing_task' };
    if (fromParent.id === INBOX_ID || toParent.id === INBOX_ID) {
      return { ok: false, reason: 'inbox' };
    }
  }

  if (wouldCreateCycle(dependencies, fromId, toId)) return { ok: false, reason: 'cycle' };
  return { ok: true };
}
