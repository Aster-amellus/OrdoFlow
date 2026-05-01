import { useEffect, useState } from 'react';
import type { EnergyLevel } from '@ordoflow/core';
import { calculateProgress, formatTimeRemaining, findTaskById } from '@ordoflow/core';
import { useStore } from '../store';

export default function DetailPanel() {
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const dependencies = useStore((s) => s.dependencies);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const selectTask = useStore((s) => s.selectTask);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const addSubtask = useStore((s) => s.addSubtask);
  const addDependency = useStore((s) => s.addDependency);
  const deleteDependency = useStore((s) => s.deleteDependency);

  const task = selectedTaskId
    ? findTaskById(inbox, selectedTaskId) || findTaskById(root, selectedTaskId)
    : null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [deadline, setDeadline] = useState('');
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | ''>('');
  const [priority, setPriority] = useState(2);
  const [newChildTitle, setNewChildTitle] = useState('');
  const [newDepId, setNewDepId] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setEstimatedMinutes(task.estimatedMinutes?.toString() || '');
      setDeadline(task.deadline || '');
      setEnergyLevel(task.energyLevel || '');
      setPriority(task.priority);
    }
  }, [task]);

  if (!task) return null;

  const handleSave = () => {
    updateTask(task.id, {
      title: title.trim() || task.title,
      description: description.trim() || undefined,
      estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes) : undefined,
      deadline: deadline || undefined,
      energyLevel: energyLevel || undefined,
      priority,
    });
  };

  const handleDelete = () => { deleteTask(task.id); selectTask(null); };

  const progress = calculateProgress(task);
  const timeLeft = formatTimeRemaining(progress.estimatedMinutesRemaining);

  // Find parent to get siblings for dependency dropdown
  const parent = findTaskById(root, task.id) ? null : null; // simplified
  const blockedBy = dependencies.filter((d) => d.toTaskId === task.id);
  const blocking = dependencies.filter((d) => d.fromTaskId === task.id);

  // Get all tasks at same level for dep dropdown
  const allTasks: { id: string; title: string }[] = [];
  const collectLeaves = (t: { id: string; title: string; subtasks: any[] }) => {
    if (t.subtasks.length === 0) allTasks.push({ id: t.id, title: t.title });
    else t.subtasks.forEach(collectLeaves);
  };
  collectLeaves(root);
  collectLeaves(inbox);
  const availableDeps = allTasks.filter((t) => t.id !== task.id);

  return (
    <div className="detail-overlay" onClick={() => selectTask(null)}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <h2>Task Details</h2>
          <button onClick={() => selectTask(null)} className="detail-close">×</button>
        </div>

        <div className="detail-body">
          <label className="field-label">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleSave} className="field-input" />

          <label className="field-label">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={handleSave} rows={3} className="field-input field-textarea" />

          <div className="field-row">
            <div className="field-col">
              <label className="field-label">Est. Minutes</label>
              <input type="number" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} onBlur={handleSave} min="0" className="field-input mono" />
            </div>
            <div className="field-col">
              <label className="field-label">Deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} onBlur={handleSave} className="field-input" />
            </div>
          </div>

          <label className="field-label">Priority</label>
          <div className="priority-options">
            {[0, 1, 2, 3].map((p) => (
              <button key={p} onClick={() => { setPriority(p); updateTask(task.id, { priority: p }); }}
                className={`priority-btn ${priority === p ? 'priority-btn-active' : ''}`}>
                {p === 0 ? 'Pinned' : p === 1 ? 'High' : p === 2 ? 'Medium' : 'Low'}
              </button>
            ))}
          </div>

          <label className="field-label">Energy Level</label>
          <div className="energy-options">
            {(['high', 'medium', 'low'] as EnergyLevel[]).map((level) => {
              const cfg = { high: { icon: '⚡', label: 'High' }, medium: { icon: '🟡', label: 'Medium' }, low: { icon: '🟢', label: 'Low' } }[level];
              return (
                <button key={level} onClick={() => { setEnergyLevel(energyLevel === level ? '' : level); setTimeout(handleSave, 0); }}
                  className={`energy-btn ${energyLevel === level ? 'energy-btn-active' : ''}`}>
                  {cfg.icon} {cfg.label}
                </button>
              );
            })}
          </div>

          <label className="field-label">Status</label>
          <div className="status-options">
            {(['pending', 'in_progress', 'done'] as const).map((s) => (
              <button key={s} onClick={() => updateTask(task.id, { status: s })}
                className={`status-btn ${task.status === s ? 'status-btn-active' : ''}`}>
                {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {progress.total > 1 && (
            <>
              <label className="field-label">Progress</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="progress-bar" style={{ flex: 1, height: 6 }}>
                  <div className="progress-bar-fill" style={{ width: `${progress.percentage}%` }} />
                </div>
                <span className="progress-text">{progress.percentage}%</span>
                {timeLeft && <span className="progress-text">· {timeLeft} left</span>}
              </div>
              <div className="progress-text">{progress.pending} pending · {progress.inProgress} active · {progress.done} done</div>
            </>
          )}

          <label className="field-label">Sub-tasks ({task.subtasks.length})</label>
          <div className="subtask-list">
            {task.subtasks.map((c) => (
              <div key={c.id} className={`subtask-item ${c.status === 'done' ? 'subtask-item-done' : ''}`}>
                <span className="subtask-checkbox" onClick={() => setTaskStatus(c.id, c.status === 'done' ? 'pending' : 'done')}>
                  {c.status === 'done' ? '✓' : ''}
                </span>
                <span className="subtask-title">{c.title}</span>
              </div>
            ))}
            <input value={newChildTitle} onChange={(e) => setNewChildTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newChildTitle.trim()) { addSubtask(task.id, newChildTitle.trim()); setNewChildTitle(''); } }}
              placeholder="Add sub-task..." className="subtask-add-input" />
          </div>

          {(blockedBy.length > 0 || blocking.length > 0) && (
            <>
              <label className="field-label">Dependencies</label>
              <div className="dep-list">
                {blockedBy.map((d) => {
                  const from = allTasks.find((t) => t.id === d.fromTaskId);
                  return (
                    <div key={d.id} className="dep-item">
                      <span className="dep-arrow">←</span> {from?.title || '?'}
                      <button onClick={() => deleteDependency(d.id)} className="dep-remove">×</button>
                    </div>
                  );
                })}
                {blocking.map((d) => {
                  const to = allTasks.find((t) => t.id === d.toTaskId);
                  return (
                    <div key={d.id} className="dep-item">
                      <span className="dep-arrow">→</span> {to?.title || '?'}
                      <button onClick={() => deleteDependency(d.id)} className="dep-remove">×</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <label className="field-label">Add dependency (blocks this task)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={newDepId} onChange={(e) => setNewDepId(e.target.value)} className="field-input" style={{ flex: 1 }}>
              <option value="">Select task...</option>
              {availableDeps.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button onClick={() => { if (newDepId) { addDependency(newDepId, task.id); setNewDepId(''); } }} className="btn-secondary" disabled={!newDepId}>Add</button>
          </div>

          <div className="detail-footer">
            <button onClick={handleDelete} className="btn-danger">Delete Task</button>
          </div>
        </div>
      </div>
    </div>
  );
}
