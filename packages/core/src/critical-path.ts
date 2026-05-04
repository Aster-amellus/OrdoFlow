import type { Task, Dependency } from './types';
import { buildSiblingGraph, getTopologicalOrder } from './topology';

interface CriticalPathResult {
  path: Task[];
  totalMinutes: number;
  bottleneck: Task | null;
}

export function calculateCriticalPath(siblings: Task[], dependencies: Dependency[]): CriticalPathResult {
  if (siblings.length === 0) return { path: [], totalMinutes: 0, bottleneck: null };

  const graph = buildSiblingGraph(siblings, dependencies);
  const order = getTopologicalOrder(siblings, dependencies);
  if (!order) return { path: [], totalMinutes: 0, bottleneck: null };

  function getEffectiveMinutes(task: Task): number {
    if (task.subtasks.length === 0) return task.estimatedMinutes || 0;
    return task.subtasks.reduce((sum, c) => sum + getEffectiveMinutes(c), 0);
  }

  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  for (const task of order) {
    const id = task.id;
    const duration = getEffectiveMinutes(task);
    let maxPrevFinish = 0;
    for (const prevId of graph.reverseAdjList.get(id) || []) {
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
    const task = graph.taskMap.get(currentId);
    if (!task) break;
    path.unshift(task);
    let prevId = '';
    let prevFinish = 0;
    for (const pId of graph.reverseAdjList.get(currentId) || []) {
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
