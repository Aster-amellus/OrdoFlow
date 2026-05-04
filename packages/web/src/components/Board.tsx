import { useState } from 'react';
import { useStore } from '../store';
import { calculateProgress, countRemaining, formatTimeRemaining } from '@ordoflow/core';

export default function Board() {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const goToProject = useStore((s) => s.goToProject);
  const addTopLevelTask = useStore((s) => s.addTopLevelTask);
  const addSubtask = useStore((s) => s.addSubtask);
  const deleteTask = useStore((s) => s.deleteTask);
  const selectTask = useStore((s) => s.selectTask);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const exportProject = useStore((s) => s.exportProject);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInboxTitle, setNewInboxTitle] = useState('');
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const task = addTopLevelTask(newName.trim());
    setNewName('');
    setIsAdding(false);
    goToProject(task.id);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteProjectId(id);
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    selectTask(id);
  };

  const handleAddInbox = () => {
    const trimmed = newInboxTitle.trim();
    if (!trimmed) return;
    addSubtask('__inbox__', trimmed);
    setNewInboxTitle('');
  };

  return (
    <div className="board">
      {/* Inbox */}
      <div className="board-inbox">
        <div className="board-section-title" onClick={() => goToProject('__inbox__')}>
          📥 Inbox
          <span className="board-section-count">({inbox.subtasks.length})</span>
        </div>
        {inbox.subtasks.length > 0 && (
          <div className="inbox-items">
            {inbox.subtasks.slice(0, 5).map((t) => (
              <div key={t.id} className={`inbox-item ${t.status === 'done' ? 'inbox-item-done' : ''}`}>
                <button
                  className="task-checkbox"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTaskStatus(t.id, t.status === 'done' ? 'pending' : 'done');
                  }}
                >
                  {t.status === 'done' ? '✓' : ''}
                </button>
                <span>{t.title}</span>
              </div>
            ))}
            {inbox.subtasks.length > 5 && (
              <div className="inbox-more">
                +{inbox.subtasks.length - 5} more...
              </div>
            )}
          </div>
        )}
        <div className="board-add-row">
          <input
            value={newInboxTitle}
            onChange={(e) => setNewInboxTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddInbox()}
            placeholder="Add quick task..."
            className="subtask-add-input"
          />
          <button onClick={handleAddInbox} disabled={!newInboxTitle.trim()} className="btn-secondary">Add</button>
        </div>
      </div>

      {/* Projects */}
      <div>
        <div className="board-section-title">
          📦 Projects
          <span className="board-section-count">({root.subtasks.length})</span>
        </div>
        <div className="board-project-list">
          {root.subtasks.map((project) => {
            const remaining = countRemaining(project);
            const progress = calculateProgress(project);
            const timeLeft = formatTimeRemaining(progress.estimatedMinutesRemaining);
            return (
              <div
                key={project.id}
                className="board-project-item"
                onClick={() => goToProject(project.id)}
              >
                <div className="board-project-main">
                  <span className="board-project-name">{project.title}</span>
                  <div className="board-project-progress">
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${progress.percentage}%` }} />
                    </div>
                    <span className="board-project-count">
                      {remaining} remaining{timeLeft ? ` · ${timeLeft}` : ''}
                    </span>
                  </div>
                </div>
                <div className="board-project-actions">
                  <button
                    className="board-project-action"
                    onClick={(e) => handleEdit(e, project.id)}
                    title="Edit project details"
                  >
                    ✎
                  </button>
                  <button
                    className="board-project-action"
                    onClick={(e) => { e.stopPropagation(); exportProject(project.id); }}
                    title="Export project"
                  >
                    ↥
                  </button>
                  <button
                    className="board-project-action board-project-action-danger"
                    onClick={(e) => handleDelete(e, project.id)}
                    title="Delete project"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}

          {isAdding ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setIsAdding(false); }}
              onBlur={() => handleAdd()}
              placeholder="Project name..."
              className="subtask-add-input"
            />
          ) : (
            <button
              className="board-project-item"
              data-empty-action="true"
              onClick={() => setIsAdding(true)}
            >
              + New Project
            </button>
          )}
        </div>
      </div>

      {deleteProjectId && (
        <div className="modal-overlay" onClick={() => setDeleteProjectId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete project?</h3>
            <p className="field-hint">This removes the project, all nested tasks, and related dependencies.</p>
            <div className="modal-actions">
              <button onClick={() => setDeleteProjectId(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  deleteTask(deleteProjectId);
                  setDeleteProjectId(null);
                }}
                className="btn-danger-inline"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
