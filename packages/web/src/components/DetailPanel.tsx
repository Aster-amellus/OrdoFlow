import { useEffect, useState } from 'react';
import type { EnergyLevel, Task } from '@ordoflow/core';
import { calculateProgress, formatTimeRemaining, findParentOf, findTaskById, INBOX_ID } from '@ordoflow/core';
import { useStore } from '../store';
import { buildAIWorkspaceContext, callAI, normalizeAIResponse, parseAIResponse } from '../ai';
import { showToast } from '../browser';

interface TaskOption {
  id: string;
  title: string;
  path: string;
  parentId: string;
}

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
  const aiConfig = useStore((s) => s.aiConfig);
  const workspaceMemory = useStore((s) => s.workspaceMemory);
  const planningMethod = useStore((s) => s.planningMethod);

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
  const [isRefining, setIsRefining] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const handleDelete = () => setShowDeleteConfirm(true);

  const confirmDelete = () => {
    deleteTask(task.id);
    selectTask(null);
  };

  const handleRefine = async () => {
    if (!aiConfig.apiKey || isRefining) return;
    setIsRefining(true);
    try {
      const workspaceContext = buildAIWorkspaceContext(root, inbox, dependencies, workspaceMemory);
      const raw = await callAI(aiConfig, `${workspaceContext}
${planningMethod.trim() ? `\nUser planning method:\n${planningMethod.trim()}\n` : ''}

Break down this selected task into 3-8 smaller subtasks with dependencies:
Title: ${task.title}
Description: ${task.description || 'none'}
Estimated time: ${task.estimatedMinutes || 0} minutes

Tasks should sum to approximately ${task.estimatedMinutes || 60} minutes.`, {
        webSearch: aiConfig.webSearchEnabled,
        searchQuery: `${task.title} ${task.description || ''}`,
      });
      const parsed = normalizeAIResponse(parseAIResponse(raw));
      const taskMap = new Map<string, string>();
      for (const t of parsed.tasks) {
        const child = addSubtask(task.id, t.title, {
          estimatedMinutes: t.estimatedMinutes,
          energyLevel: t.energyLevel,
        });
        taskMap.set(t.title, child.id);
      }
      let skipped = 0;
      for (const dep of parsed.dependencies) {
        const fromId = taskMap.get(dep.from);
        const toId = taskMap.get(dep.to);
        if (!fromId || !toId || !addDependency(fromId, toId)) skipped++;
      }
      showToast(`AI broke down into ${parsed.tasks.length} subtasks${skipped ? `, skipped ${skipped} deps` : ''}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Refine failed', 'error');
    } finally {
      setIsRefining(false);
    }
  };

  const progress = calculateProgress(task);
  const timeLeft = formatTimeRemaining(progress.estimatedMinutesRemaining);

  const blockedBy = dependencies.filter((d) => d.toTaskId === task.id);
  const blocking = dependencies.filter((d) => d.fromTaskId === task.id);

  const allTasks: TaskOption[] = [];
  const collectTasks = (t: Task, parentId: string, prefix: string) => {
    const path = prefix ? `${prefix} / ${t.title}` : t.title;
    allTasks.push({ id: t.id, title: t.title, path, parentId });
    t.subtasks.forEach(child => collectTasks(child, t.id, path));
  };
  root.subtasks.forEach(project => collectTasks(project, root.id, ''));
  const currentParent = findParentOf(root, task.id) || findParentOf(inbox, task.id);
  const availableDeps = allTasks.filter((t) => t.id !== task.id && currentParent?.id !== INBOX_ID);
  const taskById = new Map(allTasks.map(t => [t.id, t]));

  const depLabel = (id: string): string => taskById.get(id)?.path || '?';
  const depScope = (id: string): string => {
    const other = taskById.get(id);
    if (!other || !currentParent) return '';
    return other.parentId === currentParent.id ? '' : 'External';
  };

  const estimated = task.estimatedMinutes || 0;

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

          {estimated >= 60 && task.subtasks.length === 0 && aiConfig.apiKey && (
            <button
              onClick={handleRefine}
              disabled={isRefining}
              className="ai-refine-btn"
            >
              {isRefining ? 'Refining...' : `✨ Refine — break down ${estimated >= 120 ? `${Math.floor(estimated / 60)}h` : `${estimated}m`} task`}
            </button>
          )}

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
                  const scope = depScope(d.fromTaskId);
                  return (
                    <div key={d.id} className="dep-item">
                      <span className="dep-arrow">←</span>
                      <span className="dep-name">{depLabel(d.fromTaskId)}</span>
                      {scope && <span className="dep-scope">{scope}</span>}
                      <button onClick={() => deleteDependency(d.id)} className="dep-remove">×</button>
                    </div>
                  );
                })}
                {blocking.map((d) => {
                  const scope = depScope(d.toTaskId);
                  return (
                    <div key={d.id} className="dep-item">
                      <span className="dep-arrow">→</span>
                      <span className="dep-name">{depLabel(d.toTaskId)}</span>
                      {scope && <span className="dep-scope">{scope}</span>}
                      <button onClick={() => deleteDependency(d.id)} className="dep-remove">×</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {currentParent?.id !== INBOX_ID && (
            <>
              <label className="field-label">Add dependency (blocks this task)</label>
              <div className="inline-field-row">
                <select value={newDepId} onChange={(e) => setNewDepId(e.target.value)} className="field-input">
              <option value="">Select task...</option>
                  {availableDeps.map((t) => <option key={t.id} value={t.id}>{t.path}</option>)}
                </select>
                <button
                  onClick={() => {
                    if (!newDepId) return;
                    if (!addDependency(newDepId, task.id)) showToast('Cannot add dependency', 'error');
                    setNewDepId('');
                  }}
                  className="btn-secondary"
                  disabled={!newDepId}
                >
                  Add
                </button>
              </div>
            </>
          )}

          <div className="detail-footer">
            <button onClick={handleDelete} className="btn-danger">Delete Task</button>
          </div>
        </div>
      </div>
      {showDeleteConfirm && (
        <div className="confirm-popover" onClick={(e) => e.stopPropagation()}>
          <h3>Delete task?</h3>
          <p>This removes the task, its subtasks, and related dependencies.</p>
          <div className="modal-actions">
            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary">Cancel</button>
            <button onClick={confirmDelete} className="btn-danger-inline">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
