import type { Task, Dependency } from './types';
import { INBOX_ID, createInbox } from './types';
import { canAddDependency, validateWorkspaceData } from './workspace';

export interface ExportPayload {
  version: number;
  exportedAt: string;
  type: 'full' | 'project';
  projectName?: string;
  data: {
    root: Task;
    inbox: Task;
    dependencies: Dependency[];
  };
}

export type ImportValidationResult =
  | { valid: true; data: ExportPayload }
  | { valid: false; errors: string[] };

/** Serialize the full workspace to a formatted JSON string */
export function serializeState(root: Task, inbox: Task, deps: Dependency[]): string {
  const payload: ExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    type: 'full',
    data: { root, inbox, dependencies: deps },
  };
  return JSON.stringify(payload, null, 2);
}

/** Extract a single project subtree from root by projectId */
export function extractProject(root: Task, projectId: string): Task | null {
  for (const child of root.subtasks) {
    if (child.id === projectId) return child;
  }
  return null;
}

/** Serialize a single project + its own dependencies */
export function serializeProject(root: Task, projectId: string, deps: Dependency[]): string {
  const project = extractProject(root, projectId);
  if (!project) return '';

  // Collect all task IDs within this project subtree (recursive)
  const taskIds = new Set<string>();
  const collectIds = (task: Task) => {
    taskIds.add(task.id);
    task.subtasks.forEach(collectIds);
  };
  collectIds(project);

  // Filter deps to only those where both endpoints are within the project
  const projectDeps = deps.filter(
    d => taskIds.has(d.fromTaskId) && taskIds.has(d.toTaskId)
  );

  const payload: ExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    type: 'project',
    projectName: project.title,
    data: {
      root: { ...root, subtasks: [project] },
      inbox: createInbox(),
      dependencies: projectDeps,
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** Validate a raw import string */
export function validateImport(raw: string): ImportValidationResult {
  try {
    const parsed = JSON.parse(raw);
    const errors: string[] = [];

    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, errors: ['Invalid format: not a JSON object'] };
    }

    if (typeof parsed.version !== 'number') {
      errors.push('Missing or invalid "version" field (must be a number)');
    }

    const data = parsed.data;
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Missing "data" object'] };
    }

    errors.push(...validateWorkspaceData(data).errors);

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, data: parsed as ExportPayload };
  } catch (e) {
    return { valid: false, errors: [`JSON parse error: ${(e as Error).message}`] };
  }
}

export interface MergeResult {
  root: Task;
  inbox: Task;
  dependencies: Dependency[];
  skipped: number;       // duplicate IDs
  cycleSkips: number;    // deps that would create cycles
}

/** Merge imported data into current state */
export function mergeImport(
  currentRoot: Task,
  currentInbox: Task,
  currentDeps: Dependency[],
  imported: ExportPayload
): MergeResult {
  const existing = new Set<string>();
  const collectExisting = (t: Task) => { existing.add(t.id); t.subtasks.forEach(collectExisting); };
  collectExisting(currentRoot);
  collectExisting(currentInbox);

  let root = currentRoot;
  let inbox = currentInbox;
  let deps = [...currentDeps];
  let skipped = 0;
  let cycleSkips = 0;

  // Merge inbox subtasks
  for (const inboxTask of imported.data.inbox.subtasks) {
    if (existing.has(inboxTask.id)) {
      skipped++;
      continue;
    }
    existing.add(inboxTask.id);
    inbox = { ...inbox, subtasks: [...inbox.subtasks, inboxTask] };
  }

  // Merge root subtasks (top-level projects)
  for (const project of imported.data.root.subtasks) {
    if (existing.has(project.id)) {
      skipped++;
      continue;
    }
    existing.add(project.id);
    root = { ...root, subtasks: [...root.subtasks, project] };
    const collectChildIds = (t: Task) => {
      t.subtasks.forEach(c => { existing.add(c.id); collectChildIds(c); });
    };
    collectChildIds(project);
  }

  // Merge dependencies
  for (const dep of imported.data.dependencies) {
    if (deps.some(d => d.fromTaskId === dep.fromTaskId && d.toTaskId === dep.toTaskId)) {
      skipped++;
      continue;
    }
    const check = canAddDependency(deps, dep.fromTaskId, dep.toTaskId, { root, inbox });
    if (!check.ok) {
      if (check.reason === 'cycle') cycleSkips++;
      else skipped++;
      continue;
    }
    deps.push(dep);
  }

  return { root, inbox, dependencies: deps, skipped, cycleSkips };
}
