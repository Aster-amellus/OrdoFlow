import { useMemo } from 'react';
import type { Task } from '@ordoflow/core';
import { useStore, type SortMode } from '../store';
import TaskItem from './TaskItem';

const sortOptions: { value: SortMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'priority', label: 'Priority' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'duration', label: 'Duration' },
  { value: 'energy', label: 'Energy' },
];

interface Props {
  layerIndex: number;
  tasks: Task[];
  allTasks: Task[];
  isActionable: boolean;
  criticalTaskIds: Set<string>;
  isSelectionMode?: boolean;
}

export default function LayerSection({ layerIndex, tasks, allTasks, isActionable, criticalTaskIds, isSelectionMode }: Props) {
  const sortModes = useStore((s) => s.sortModes);
  const setSortMode = useStore((s) => s.setSortMode);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const sortMode = sortModes[currentProjectId || ''] || 'manual';
  const dependencies = useStore((s) => s.dependencies);

  const allDone = tasks.every((t) => t.status === 'done');

  const isTaskLocked = (task: Task): boolean => {
    if (task.status === 'done') return false;
    const deps = dependencies.filter((d) => d.toTaskId === task.id);
    return deps.some((d) => {
      const depTask = allTasks.find((t) => t.id === d.fromTaskId);
      return depTask && depTask.status !== 'done';
    });
  };

  if (allDone && tasks.length > 0) {
    return (
      <div className="layer-section">
        <div className="layer-header">
          <span className="layer-header-title">
            <span className="layer-badge-waiting">Done</span>
            <span className="layer-header-label">{tasks.length} tasks</span>
          </span>
        </div>
        <div>
          {tasks.map((t) => (
            <TaskItem key={t.id} task={t} isLocked={isTaskLocked(t)} isCritical={criticalTaskIds.has(t.id)} isSelectionMode={isSelectionMode} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="layer-section">
      <div className="layer-header">
        <span className="layer-header-title">
          <span>{isActionable ? 'Actionable' : `Layer ${layerIndex}`}</span>
          {isActionable && <span className="layer-header-label">next up</span>}
        </span>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(currentProjectId || '', e.target.value as SortMode)}
          className="layer-sort-select"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {tasks.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          isLocked={isTaskLocked(t)}
          isCritical={criticalTaskIds.has(t.id)}
          isSelectionMode={isSelectionMode}
        />
      ))}
    </div>
  );
}
