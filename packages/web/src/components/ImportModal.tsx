import { useStore } from '../store';

export default function ImportModal() {
  const importPreview = useStore((s) => s.importPreview);
  const doImport = useStore((s) => s.doImport);
  const cancelImport = useStore((s) => s.cancelImport);

  if (!importPreview) return null;

  const { data } = importPreview;
  const projectCount = data.root.subtasks?.length || 0;
  const inboxCount = data.inbox.subtasks?.length || 0;
  const depCount = data.dependencies?.length || 0;

  // Count total tasks recursively
  const countTasks = (t: { subtasks?: unknown[] }): number => {
    if (!t.subtasks) return 0;
    return t.subtasks.length + (t.subtasks as any[]).reduce((s, c) => s + countTasks(c as any), 0);
  };
  const totalProjectTasks = data.root.subtasks?.reduce((s, p) => s + countTasks(p as any), 0) || 0;
  const totalTasks = totalProjectTasks + inboxCount;

  return (
    <div className="modal-overlay" onClick={cancelImport}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3>Import Data</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
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
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <label className="import-mode-btn">
            <input
              type="radio"
              name="importMode"
              value="replace"
              defaultChecked
              style={{ marginRight: 6 }}
            />
            Replace
          </label>
          <label className="import-mode-btn">
            <input
              type="radio"
              name="importMode"
              value="merge"
              style={{ marginRight: 6 }}
            />
            Merge
          </label>
        </div>

        <p className="field-hint" style={{ marginBottom: 16 }}>
          Replace downloads a backup first, then loads the imported data.
          Merge adds to existing data, skipping duplicates.
        </p>

        <div className="modal-actions">
          <button onClick={cancelImport} className="btn-secondary">Cancel</button>
          <button onClick={() => {
            const mode = (document.querySelector('input[name="importMode"]:checked') as HTMLInputElement)?.value as 'replace' | 'merge' || 'replace';
            doImport(mode);
          }} className="btn-primary">Import</button>
        </div>
      </div>
    </div>
  );
}
