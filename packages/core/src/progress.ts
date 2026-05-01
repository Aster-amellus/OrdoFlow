import type { Task } from './types';

export interface TaskProgress {
  percentage: number;
  estimatedMinutesRemaining: number;
  pending: number;
  inProgress: number;
  done: number;
  total: number;
}

export function calculateProgress(task: Task): TaskProgress {
  if (task.subtasks.length === 0) {
    const done = task.status === 'done' ? 1 : 0;
    const inProgress = task.status === 'in_progress' ? 1 : 0;
    const pending = task.status === 'pending' ? 1 : 0;
    return {
      percentage: done * 100,
      estimatedMinutesRemaining: done ? 0 : (task.estimatedMinutes || 0),
      pending,
      inProgress,
      done,
      total: 1,
    };
  }

  const childProgresses = task.subtasks.map(c => calculateProgress(c));
  const done = childProgresses.filter(p => p.percentage === 100).length;
  const inProgress = task.subtasks.filter(c => c.status === 'in_progress').length;
  const pending = task.subtasks.filter(c => c.status === 'pending').length;

  const totalMinutesRemaining = task.subtasks
    .filter(c => c.status !== 'done')
    .reduce((sum, c) => sum + calculateProgress(c).estimatedMinutesRemaining, 0);

  return {
    percentage: Math.round((done / task.subtasks.length) * 100),
    estimatedMinutesRemaining: totalMinutesRemaining,
    pending,
    inProgress,
    done,
    total: task.subtasks.length,
  };
}

export function formatTimeRemaining(minutes: number): string {
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
