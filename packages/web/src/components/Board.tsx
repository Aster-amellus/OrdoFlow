import { useState } from 'react';
import { useStore } from '../store';
import { countRemaining } from '@ordoflow/core';

export default function Board() {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const goToProject = useStore((s) => s.goToProject);
  const addTopLevelTask = useStore((s) => s.addTopLevelTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const selectTask = useStore((s) => s.selectTask);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const handleAdd = () => {
    if (!newName.trim()) return;
    const task = addTopLevelTask(newName.trim());
    setNewName('');
    setIsAdding(false);
    goToProject(task.id);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this project and all its tasks?')) {
      deleteTask(id);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    selectTask(id);
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
              <div key={t.id} className="inbox-item">
                <span>{t.title}</span>
              </div>
            ))}
            {inbox.subtasks.length > 5 && (
              <div className="inbox-item" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                +{inbox.subtasks.length - 5} more...
              </div>
            )}
          </div>
        )}
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
            return (
              <div
                key={project.id}
                className="board-project-item"
                onClick={() => goToProject(project.id)}
              >
                <span className="board-project-name">{project.title}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="board-project-count">{remaining} remaining</span>
                  <button
                    className="board-project-action"
                    onClick={(e) => handleEdit(e, project.id)}
                    title="Edit project details"
                  >
                    ✎
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
              style={{ borderStyle: 'dashed', color: 'var(--text-muted)', justifyContent: 'center' }}
              onClick={() => setIsAdding(true)}
            >
              + New Project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
