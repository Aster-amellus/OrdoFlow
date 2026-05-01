import { memo, useState } from 'react';
import type { Task, EnergyLevel } from '@ordoflow/core';
import { calculateProgress } from '@ordoflow/core';
import { useStore } from '../store';

const energyIcons: Record<EnergyLevel, string> = { high: '⚡', medium: '🟡', low: '🟢' };

interface Props {
  task: Task;
  isLocked?: boolean;
  isCritical?: boolean;
  isSelectionMode?: boolean;
}

function TaskItem({ task, isLocked, isCritical, isSelectionMode }: Props) {
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const selectTask = useStore((s) => s.selectTask);
  const updateTask = useStore((s) => s.updateTask);
  const goToProject = useStore((s) => s.goToProject);
  const selectedTaskIds = useStore((s) => s.selectedTaskIds);
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const isSelected = selectedTaskIds.has(task.id);

  const energy = task.energyLevel ? energyIcons[task.energyLevel] : null;
  const progress = calculateProgress(task);
  const hasChildren = task.subtasks.length > 0;

  const handleToggle = () => {
    if (isLocked || hasChildren) return;
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
      className={`task-item ${task.status === 'done' ? 'task-done' : ''} ${isLocked ? 'task-locked' : ''} ${isCritical ? 'task-critical' : ''} ${isSelected ? 'task-selected' : ''}`}
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

      {isLocked && <span style={{ fontSize: 12 }}>🔒</span>}
      {isCritical && <span style={{ fontSize: 12, cursor: 'help' }} title="If this delays, the whole project delays">🚩</span>}
    </div>
  );
}

export default memo(TaskItem);
