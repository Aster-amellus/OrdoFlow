import type { Task, Dependency, TaskStatus } from './types';

export function getEffectiveStatus(task: Task): TaskStatus {
  if (task.subtasks.length === 0) return task.status;
  if (task.subtasks.every(t => getEffectiveStatus(t) === 'done')) return 'done';
  if (task.subtasks.some(t => getEffectiveStatus(t) === 'in_progress')) return 'in_progress';
  return 'pending';
}

export type SortMode = 'manual' | 'priority' | 'deadline' | 'duration' | 'energy';

const energyOrder = { high: 0, medium: 1, low: 2 };

export function sortSiblings(siblings: Task[], dependencies: Dependency[], mode: SortMode): Task[] {
  if (siblings.length <= 1) return siblings;

  const sorted = [...siblings];

  switch (mode) {
    case 'priority':
      sorted.sort((a, b) => a.priority - b.priority);
      break;
    case 'deadline':
      sorted.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
      break;
    case 'duration':
      sorted.sort((a, b) => (a.estimatedMinutes ?? Infinity) - (b.estimatedMinutes ?? Infinity));
      break;
    case 'energy':
      sorted.sort((a, b) => {
        const aO = a.energyLevel ? energyOrder[a.energyLevel] : 99;
        const bO = b.energyLevel ? energyOrder[b.energyLevel] : 99;
        return aO - bO;
      });
      break;
    case 'manual':
    default:
      // Topological sort among siblings using their dependencies
      return topologicalSortSiblings(siblings, dependencies);
  }

  return sorted;
}

function topologicalSortSiblings(siblings: Task[], dependencies: Dependency[]): Task[] {
  const siblingIds = new Set(siblings.map(t => t.id));
  const taskMap = new Map(siblings.map(t => [t.id, t]));

  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const task of siblings) {
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
  }

  for (const dep of dependencies) {
    if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
      adjList.get(dep.fromTaskId)!.push(dep.toTaskId);
      inDegree.set(dep.toTaskId, (inDegree.get(dep.toTaskId) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: Task[] = [];
  const layers: Task[][] = [];

  while (queue.length > 0) {
    const layer: Task[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      const task = taskMap.get(id)!;
      layer.push(task);

      for (const neighbor of adjList.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextQueue.push(neighbor);
      }
    }

    layers.push(layer);
    queue.length = 0;
    queue.push(...nextQueue);
  }

  // If cycle detected, return original order
  const visitedCount = layers.reduce((sum, l) => sum + l.length, 0);
  if (visitedCount < siblings.length) return siblings;

  return layers.flat();
}

export function getLayers(siblings: Task[], dependencies: Dependency[]): Task[][] {
  const siblingIds = new Set(siblings.map(t => t.id));
  const taskMap = new Map(siblings.map(t => [t.id, t]));

  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const task of siblings) {
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
  }

  for (const dep of dependencies) {
    if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
      adjList.get(dep.fromTaskId)!.push(dep.toTaskId);
      inDegree.set(dep.toTaskId, (inDegree.get(dep.toTaskId) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const layers: Task[][] = [];

  while (queue.length > 0) {
    const layer: Task[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      const task = taskMap.get(id)!;
      layer.push(task);

      for (const neighbor of adjList.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextQueue.push(neighbor);
      }
    }

    layers.push(layer);
    queue.length = 0;
    queue.push(...nextQueue);
  }

  const visitedCount = layers.reduce((sum, l) => sum + l.length, 0);
  if (visitedCount < siblings.length) return [siblings];

  return layers;
}

export function wouldCreateCycle(
  dependencies: Dependency[],
  newFromId: string,
  newToId: string
): boolean {
  if (newFromId === newToId) return true;

  const visited = new Set<string>();
  const stack = [newFromId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === newToId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const dep of dependencies) {
      if (dep.toTaskId === current) {
        stack.push(dep.fromTaskId);
      }
    }
  }

  return false;
}
