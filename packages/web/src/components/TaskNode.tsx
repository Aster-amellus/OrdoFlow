import { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Task, EnergyLevel } from '@ordoflow/core';
import { calculateProgress } from '@ordoflow/core';
import { useStore } from '../store';

const energyIcons: Record<EnergyLevel, string> = { high: '⚡', medium: '🟡', low: '🟢' };

function TaskNode({ data, id }: NodeProps) {
  const task = data as unknown as Task;
  const updateTask = useStore((s) => s.updateTask);
  const selectTask = useStore((s) => s.selectTask);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [isEditing]);

  const progress = calculateProgress(task);
  const hasChildren = task.subtasks.length > 0;

  const statusBorder = {
    pending: 'var(--text-muted)', in_progress: 'var(--accent)', done: 'var(--accent)',
  }[task.status];

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (title.trim() && title !== task.title) updateTask(id, { title: title.trim() });
    else setTitle(task.title);
  };

  return (
    <div className="graph-node" style={{ borderColor: statusBorder }}>
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <Handle type="source" position={Position.Right} className="graph-handle" />

      <div className="graph-node-title" onDoubleClick={handleDoubleClick}>
        {isEditing ? (
          <input ref={inputRef} value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); if (e.key === 'Escape') { setTitle(task.title); setIsEditing(false); } }}
            className="graph-node-input" />
        ) : (
          <span className={task.status === 'done' ? 'line-through' : ''}>
            {task.title}
          </span>
        )}
      </div>

      <div className="graph-node-meta mono">
        {hasChildren && (
          <div className="progress-bar" style={{ width: 48 }}>
            <div className="progress-bar-fill" style={{ width: `${progress.percentage}%` }} />
          </div>
        )}
        {!hasChildren && task.estimatedMinutes && (
          <span>{task.estimatedMinutes >= 60
            ? `${Math.floor(task.estimatedMinutes / 60)}h${task.estimatedMinutes % 60 ? ` ${task.estimatedMinutes % 60}m` : ''}`
            : `${task.estimatedMinutes}m`}</span>
        )}
        {task.energyLevel && <span>{energyIcons[task.energyLevel]}</span>}
      </div>
    </div>
  );
}

export default memo(TaskNode);
