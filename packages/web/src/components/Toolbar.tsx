import { useState } from 'react';
import { useStore } from '../store';
import { INBOX_ID, findTaskById } from '@ordoflow/core';
import { callAI, parseAIResponse, PROVIDER_DEFAULTS, type AIProvider } from '../ai';

type AIFlowStep = 'input' | 'confirm' | 'loading';

export default function Toolbar() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const currentView = useStore((s) => s.currentView);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const goToBoard = useStore((s) => s.goToBoard);
  const goToProject = useStore((s) => s.goToProject);
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const addTopLevelTask = useStore((s) => s.addTopLevelTask);
  const addSubtask = useStore((s) => s.addSubtask);
  const addDependency = useStore((s) => s.addDependency);
  const aiConfig = useStore((s) => s.aiConfig);
  const setAIConfig = useStore((s) => s.setAIConfig);

  const [showSettings, setShowSettings] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiFlowStep, setAiFlowStep] = useState<AIFlowStep>('input');
  const [showAIModal, setShowAIModal] = useState(false);

  // AI confirmation state
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [granularity, setGranularity] = useState<'high' | 'medium' | 'detailed'>('medium');

  const [formProvider, setFormProvider] = useState(aiConfig.provider);
  const [formApiKey, setFormApiKey] = useState(aiConfig.apiKey);
  const [formBaseUrl, setFormBaseUrl] = useState(aiConfig.baseUrl);
  const [formModel, setFormModel] = useState(aiConfig.model);

  const openSettings = () => {
    setFormProvider(aiConfig.provider);
    setFormApiKey(aiConfig.apiKey);
    setFormBaseUrl(aiConfig.baseUrl);
    setFormModel(aiConfig.model);
    setShowSettings(true);
  };

  const handleProviderChange = (p: AIProvider) => {
    setFormProvider(p);
    setFormBaseUrl(PROVIDER_DEFAULTS[p].baseUrl);
    setFormModel(PROVIDER_DEFAULTS[p].model);
  };

  const handleSaveSettings = () => {
    setAIConfig({ provider: formProvider, apiKey: formApiKey, baseUrl: formBaseUrl, model: formModel });
    setShowSettings(false);
  };

  const handleStartAI = () => {
    if (!aiInput.trim() || !aiConfig.apiKey) return;
    // Show confirmation modal
    setTargetProjectId(currentProjectId || '');
    setGranularity('medium');
    setShowAIModal(true);
    setAiFlowStep('confirm');
  };

  const handleConfirmAI = async () => {
    setShowAIModal(false);
    setAiFlowStep('loading');

    try {
      const existingProjects = root.subtasks.map((t) => ({ id: t.id, name: t.title }));
      const projectContext = existingProjects.map((p) => p.name).join(', ') || 'none';

      const granularityPrompt = {
        high: 'Break into 3-5 high-level milestones.',
        medium: 'Break into 6-12 tasks with moderate detail.',
        detailed: 'Break into 15-25 detailed steps.',
      }[granularity];

      const enhancedInput = `Existing projects: ${projectContext}
${granularityPrompt}

User wants to: ${aiInput}`;

      const raw = await callAI(aiConfig, enhancedInput);
      const parsed = parseAIResponse(raw);

      // Determine target project
      let parentId = targetProjectId;

      // If no target selected or target is inbox, create new project
      if (!parentId || parentId === INBOX_ID) {
        if (parsed.tasks.length > 2) {
          const newProject = addTopLevelTask(aiInput.slice(0, 50));
          parentId = newProject.id;
        } else {
          parentId = INBOX_ID;
        }
      }

      const taskMap = new Map<string, string>();

      parsed.tasks.forEach((t) => {
        const task = addSubtask(parentId, t.title, {
          estimatedMinutes: t.estimatedMinutes,
          energyLevel: t.energyLevel as any,
        });
        taskMap.set(t.title, task.id);
      });

      let skippedCycles = 0;
      parsed.dependencies?.forEach((d) => {
        const fromId = taskMap.get(d.from);
        const toId = taskMap.get(d.to);
        if (fromId && toId) {
          if (!addDependency(fromId, toId)) skippedCycles++;
        }
      });

      if (skippedCycles > 0) {
        window.dispatchEvent(new CustomEvent('ordoflow-toast', {
          detail: { message: `Skipped ${skippedCycles} cycle-causing dependencies`, type: 'info' },
        }));
      }

      // Navigate to the project we just added to
      if (parentId !== INBOX_ID) {
        goToProject(parentId);
      }

      setAiInput('');
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ordoflow-toast', {
        detail: { message: err.message || 'AI breakdown failed', type: 'error' },
      }));
    } finally {
      setAiFlowStep('input');
    }
  };

  const currentProject = currentProjectId
    ? (currentProjectId === INBOX_ID ? inbox : findTaskById(root, currentProjectId))
    : null;

  return (
    <>
      <header className="toolbar">
        <div className="toolbar-brand" onClick={goToBoard}>
          <span className="toolbar-logo">⚡</span>
          <span className="toolbar-title">OrdoFlow</span>
        </div>

        {currentView === 'project' && currentProject && (
          <button onClick={goToBoard} className="toolbar-back">← {currentProject.title}</button>
        )}

        <div className="toolbar-center">
          <div className="ai-input-group">
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartAI()}
              placeholder="Break down a goal with AI..."
              className="ai-input"
              disabled={!aiConfig.apiKey || aiFlowStep === 'loading'}
            />
            <button
              onClick={handleStartAI}
              disabled={!aiInput.trim() || !aiConfig.apiKey || aiFlowStep === 'loading'}
              className="ai-btn"
            >
              {aiFlowStep === 'loading' ? '...' : 'Break Down'}
            </button>
            {!aiConfig.apiKey && <button onClick={openSettings} className="settings-link">Set API Key</button>}
          </div>
        </div>

        <div className="toolbar-right">
          {currentView === 'project' && (
            <div className="view-toggle">
              <button onClick={() => setViewMode('list')} className={`view-btn ${viewMode === 'list' ? 'view-btn-active' : ''}`}>List</button>
              <button onClick={() => setViewMode('graph')} className={`view-btn ${viewMode === 'graph' ? 'view-btn-active' : ''}`}>Graph</button>
            </div>
          )}
          <button onClick={openSettings} className="toolbar-settings">⚙</button>
        </div>
      </header>

      {/* AI Confirmation Modal */}
      {showAIModal && (
        <div className="modal-overlay" onClick={() => setShowAIModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Break Down: "{aiInput}"</h3>

            <label className="field-label">Target Project</label>
            <select
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
              className="field-input"
            >
              <option value="">Create new project</option>
              <option value={INBOX_ID}>Inbox (small tasks only)</option>
              {root.subtasks.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>

            <label className="field-label">Granularity</label>
            <div className="priority-options">
              {(['high', 'medium', 'detailed'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`priority-btn ${granularity === g ? 'priority-btn-active' : ''}`}
                >
                  {g === 'high' ? 'High (3-5)' : g === 'medium' ? 'Medium (6-12)' : 'Detailed (15-25)'}
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowAIModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleConfirmAI} className="btn-primary">Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>AI Provider Settings</h3>
            <label className="field-label">Provider</label>
            <div className="provider-options">
              {(Object.keys(PROVIDER_DEFAULTS) as AIProvider[]).map((p) => (
                <button key={p} onClick={() => handleProviderChange(p)} className={`provider-btn ${formProvider === p ? 'provider-btn-active' : ''}`}>
                  {PROVIDER_DEFAULTS[p].label}
                </button>
              ))}
            </div>
            <label className="field-label">API Key</label>
            <input type="password" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="sk-..." className="field-input" />
            <label className="field-label">Base URL</label>
            <input type="text" value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} className="field-input mono" />
            <label className="field-label">Model</label>
            <input type="text" value={formModel} onChange={(e) => setFormModel(e.target.value)} className="field-input mono" />
            {formProvider === 'deepseek' && <p className="field-hint">DeepSeek uses OpenAI-compatible API.</p>}
            {formProvider === 'custom' && <p className="field-hint">Any OpenAI-compatible endpoint.</p>}
            <div className="modal-actions">
              <button onClick={() => setShowSettings(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveSettings} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
