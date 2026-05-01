import type { Task, Dependency } from './types';

interface CriticalPathResult {
  path: Task[];
  totalMinutes: number;
  bottleneck: Task | null;
}

export function calculateCriticalPath(siblings: Task[], dependencies: Dependency[]): CriticalPathResult {
  if (siblings.length === 0) return { path: [], totalMinutes: 0, bottleneck: null };

  const siblingIds = new Set(siblings.map(t => t.id));
  const taskMap = new Map(siblings.map(t => [t.id, t]));

  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  const reverseAdjList = new Map<string, string[]>();

  for (const task of siblings) {
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
    reverseAdjList.set(task.id, []);
  }

  for (const dep of dependencies) {
    if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
      adjList.get(dep.fromTaskId)!.push(dep.toTaskId);
      reverseAdjList.get(dep.toTaskId)!.push(dep.fromTaskId);
      inDegree.set(dep.toTaskId, (inDegree.get(dep.toTaskId) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  const tempInDegree = new Map(inDegree);

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjList.get(current) || []) {
      const newDegree = (tempInDegree.get(neighbor) || 1) - 1;
      tempInDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  function getEffectiveMinutes(task: Task): number {
    if (task.subtasks.length === 0) return task.estimatedMinutes || 0;
    return task.subtasks.reduce((sum, c) => sum + getEffectiveMinutes(c), 0);
  }

  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  for (const id of order) {
    const task = taskMap.get(id)!;
    const duration = getEffectiveMinutes(task);
    let maxPrevFinish = 0;
    for (const prevId of reverseAdjList.get(id) || []) {
      maxPrevFinish = Math.max(maxPrevFinish, earliestFinish.get(prevId) || 0);
    }
    earliestStart.set(id, maxPrevFinish);
    earliestFinish.set(id, maxPrevFinish + duration);
  }

  let maxFinish = 0;
  let endTaskId = '';
  for (const [id, finish] of earliestFinish) {
    if (finish > maxFinish) {
      maxFinish = finish;
      endTaskId = id;
    }
  }

  const path: Task[] = [];
  let currentId = endTaskId;
  while (currentId) {
    const task = taskMap.get(currentId);
    if (!task) break;
    path.unshift(task);
    let prevId = '';
    let prevFinish = 0;
    for (const pId of reverseAdjList.get(currentId) || []) {
      const finish = earliestFinish.get(pId) || 0;
      if (finish > prevFinish) {
        prevFinish = finish;
        prevId = pId;
      }
    }
    currentId = prevId;
  }

  const bottleneck = path.reduce((max, task) => {
    if (!max) return task;
    return (task.estimatedMinutes || 0) > (max.estimatedMinutes || 0) ? task : max;
  }, null as Task | null);

  return { path, totalMinutes: maxFinish, bottleneck };
}
