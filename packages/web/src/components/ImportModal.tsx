import { useState } from 'react';
import type { Task } from '@ordoflow/core';
import { useStore } from '../store';

export default function ImportModal() {
  const importPreview = useStore((s) => s.importPreview);
  const doImport = useStore((s) => s.doImport);
  const cancelImport = useStore((s) => s.cancelImport);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');

  if (!importPreview) return null;

  const { data } = importPreview;
  const projectCount = data.root.subtasks?.length || 0;
  const inboxCount = data.inbox.subtasks?.length || 0;
  const depCount = data.dependencies?.length || 0;

  // Count total tasks recursively
  const countTasks = (t: Pick<Task, 'subtasks'>): number => {
    if (!t.subtasks) return 0;
    return t.subtasks.length + t.subtasks.reduce((s, c) => s + countTasks(c), 0);
  };
  const totalProjectTasks = data.root.subtasks?.reduce((s, p) => s + countTasks(p), 0) || 0;
  const totalTasks = totalProjectTasks + inboxCount;

  return (
    <div className="modal-overlay" onClick={cancelImport}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import Data</h3>

        <div className="import-stats">
          <div className="import-stat">
            <span>Type</span>
            <span>{importPreview.type === 'full' ? 'Full workspace' : `Project: ${importPreview.projectName || '?'}`}</span>
          </div>
          <div className="import-stat">
            <span>Projects</span>
            <span>{projectCount}</span>
          </div>
          <div className="import-stat">
            <span>Tasks (total)</span>
            <span>{totalTasks}</span>
          </div>
          <div className="import-stat">
            <span>Dependencies</span>
            <span>{depCount}</span>
          </div>
          <div className="import-stat">
            <span>Inbox items</span>
            <span>{inboxCount}</span>
          </div>
        </div>

        <label className="field-label">Import mode</label>
        <div className="import-mode-row">
          <label className="import-mode-btn">
            <input
              type="radio"
              name="importMode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace
          </label>
          <label className="import-mode-btn">
            <input
              type="radio"
              name="importMode"
              value="merge"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            Merge
          </label>
        </div>

        <p className="field-hint import-hint">
          Replace downloads a backup first, then loads the imported data.
          Merge adds to existing data, skipping duplicates.
        </p>

        <div className="modal-actions">
          <button onClick={cancelImport} className="btn-secondary">Cancel</button>
          <button onClick={() => doImport(mode)} className="btn-primary">Import</button>
        </div>
      </div>
    </div>
  );
}
