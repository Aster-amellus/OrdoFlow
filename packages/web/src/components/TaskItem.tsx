import { memo, useState } from 'react';
import type { Task, EnergyLevel } from '@ordoflow/core';
import { calculateProgress, findParentOf, findTaskById, getEffectiveStatus } from '@ordoflow/core';
import { useStore } from '../store';

const energyIcons: Record<EnergyLevel, string> = { high: '⚡', medium: '🟡', low: '🟢' };

interface Props {
  task: Task;
  isLocked?: boolean;
  isCritical?: boolean;
  isSelectionMode?: boolean;
}

function TaskItem({ task, isLocked, isCritical, isSelectionMode }: Props) {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const selectTask = useStore((s) => s.selectTask);
  const updateTask = useStore((s) => s.updateTask);
  const goToProject = useStore((s) => s.goToProject);
  const selectedTaskIds = useStore((s) => s.selectedTaskIds);
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection);
  const dependencies = useStore((s) => s.dependencies);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const isSelected = selectedTaskIds.has(task.id);

  const energy = task.energyLevel ? energyIcons[task.energyLevel] : null;
  const progress = calculateProgress(task);
  const hasChildren = task.subtasks.length > 0;
  const currentParent = findParentOf(root, task.id) || findParentOf(inbox, task.id);
  const blockingDeps = dependencies
    .filter((dep) => dep.toTaskId === task.id)
    .map((dep) => {
      const blocker = findTaskById(root, dep.fromTaskId) || findTaskById(inbox, dep.fromTaskId);
      if (!blocker || getEffectiveStatus(blocker) === 'done') return null;
      const blockerParent = findParentOf(root, blocker.id) || findParentOf(inbox, blocker.id);
      return {
        task: blocker,
        external: currentParent?.id !== blockerParent?.id,
      };
    })
    .filter((dep): dep is { task: Task; external: boolean } => dep !== null);
  const isEffectivelyLocked = task.status !== 'done' && Boolean(isLocked || blockingDeps.length > 0);
  const externalBlockers = blockingDeps.filter(dep => dep.external);
  const lockedTitle = blockingDeps.length > 0
    ? `Blocked by ${blockingDeps.map(dep => dep.task.title).join(', ')}`
    : 'Blocked by dependencies';

  const handleToggle = () => {
    if (isEffectivelyLocked || hasChildren) return;
    setTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done');
  };

  const handleTitleBlur = () => {
    setIsEditing(false);
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
    else setEditTitle(task.title);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectionMode) {
      toggleTaskSelection(task.id);
      return;
    }
    if (hasChildren) {
      goToProject(task.id);
    } else {
      selectTask(task.id);
    }
  };

  return (
    <div
      className={`task-item ${task.status === 'done' ? 'task-done' : ''} ${isEffectivelyLocked ? 'task-locked' : ''} ${isCritical ? 'task-critical' : ''} ${isSelected ? 'task-selected' : ''}`}
      onClick={handleClick}
    >
      <button className="task-checkbox" onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
        {task.status === 'done' ? '✓' : ''}
      </button>

      <div className="task-content">
        {isEditing ? (
          <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleBlur} onKeyDown={(e) => { if (e.key === 'Enter') handleTitleBlur(); }}
            onClick={(e) => e.stopPropagation()} autoFocus className="task-title-input" />
        ) : (
          <span className="task-title" onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>
            {task.title}
          </span>
        )}
        <span className="task-meta">
          {energy && <span title={task.energyLevel!}>{energy}</span>}
          {hasChildren && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({progress.total})</span>}
        </span>
      </div>

      {hasChildren && (
        <div className="progress-bar-container">
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress.percentage}%` }} />
          </div>
          <span className="progress-text">{progress.done}/{progress.total}</span>
        </div>
      )}

      {!hasChildren && task.estimatedMinutes && (
        <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {task.estimatedMinutes >= 60
            ? `${Math.floor(task.estimatedMinutes / 60)}h${task.estimatedMinutes % 60 ? ` ${task.estimatedMinutes % 60}m` : ''}`
            : `${task.estimatedMinutes}m`}
        </span>
      )}

      {externalBlockers.length > 0 && <span className="task-external-dep" title={lockedTitle}>External</span>}
      {isEffectivelyLocked && <span className="task-state-icon" title={lockedTitle}>🔒</span>}
      {isCritical && <span className="task-state-icon" title="If this delays, the whole project delays">🚩</span>}
    </div>
  );
}

export default memo(TaskItem);
