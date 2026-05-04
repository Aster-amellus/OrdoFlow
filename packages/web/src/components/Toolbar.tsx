import { useState, useRef } from 'react';
import { useStore } from '../store';
import { INBOX_ID, findTaskById } from '@ordoflow/core';
import {
  buildAIWorkspaceContext,
  callAI,
  normalizeAIResponse,
  parseAIResponse,
  PROVIDER_DEFAULTS,
  type AIProvider,
} from '../ai';
import { showToast } from '../browser';

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
  const workspaceMemory = useStore((s) => s.workspaceMemory);
  const setWorkspaceMemory = useStore((s) => s.setWorkspaceMemory);
  const planningMethod = useStore((s) => s.planningMethod);
  const setPlanningMethod = useStore((s) => s.setPlanningMethod);
  const exportAll = useStore((s) => s.exportAll);
  const startImport = useStore((s) => s.startImport);
  const dependencies = useStore((s) => s.dependencies);

  const [showSettings, setShowSettings] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiFlowStep, setAiFlowStep] = useState<AIFlowStep>('input');
  const [showAIModal, setShowAIModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI confirmation state
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [granularity, setGranularity] = useState<'high' | 'medium' | 'detailed'>('medium');

  const [formProvider, setFormProvider] = useState(aiConfig.provider);
  const [formApiKey, setFormApiKey] = useState(aiConfig.apiKey);
  const [formBaseUrl, setFormBaseUrl] = useState(aiConfig.baseUrl);
  const [formModel, setFormModel] = useState(aiConfig.model);
  const [formWebSearchEnabled, setFormWebSearchEnabled] = useState(aiConfig.webSearchEnabled || false);
  const [formSearchProvider, setFormSearchProvider] = useState(aiConfig.searchProvider || 'tavily');
  const [formTavilyApiKey, setFormTavilyApiKey] = useState(aiConfig.tavilyApiKey || '');
  const [formTavilyMaxResults, setFormTavilyMaxResults] = useState(String(aiConfig.tavilyMaxResults || 5));
  const [formMemory, setFormMemory] = useState(workspaceMemory);
  const [formPlanningMethod, setFormPlanningMethod] = useState(planningMethod);

  const openSettings = () => {
    setFormProvider(aiConfig.provider);
    setFormApiKey(aiConfig.apiKey);
    setFormBaseUrl(aiConfig.baseUrl);
    setFormModel(aiConfig.model);
    setFormWebSearchEnabled(aiConfig.webSearchEnabled || false);
    setFormSearchProvider(aiConfig.searchProvider || 'tavily');
    setFormTavilyApiKey(aiConfig.tavilyApiKey || '');
    setFormTavilyMaxResults(String(aiConfig.tavilyMaxResults || 5));
    setFormMemory(workspaceMemory);
    setFormPlanningMethod(planningMethod);
    setShowSettings(true);
  };

  const handleProviderChange = (p: AIProvider) => {
    setFormProvider(p);
    setFormBaseUrl(PROVIDER_DEFAULTS[p].baseUrl);
    setFormModel(PROVIDER_DEFAULTS[p].model);
  };

  const handleSaveSettings = () => {
    setAIConfig({
      provider: formProvider,
      apiKey: formApiKey,
      baseUrl: formBaseUrl,
      model: formModel,
      webSearchEnabled: formWebSearchEnabled,
      searchProvider: formSearchProvider,
      tavilyApiKey: formTavilyApiKey,
      tavilyMaxResults: Math.max(1, Math.min(20, parseInt(formTavilyMaxResults) || 5)),
    });
    setWorkspaceMemory(formMemory);
    setPlanningMethod(formPlanningMethod);
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
      const workspaceContext = buildAIWorkspaceContext(root, inbox, dependencies, workspaceMemory);

      const granularityPrompt = {
        high: 'Break into 3-5 high-level milestones.',
        medium: 'Break into 6-12 tasks with moderate detail.',
        detailed: 'Break into 15-25 detailed steps.',
      }[granularity];

      const enhancedInput = `${workspaceContext}

Existing projects: ${projectContext}
${granularityPrompt}
${planningMethod.trim() ? `\nUser planning method:\n${planningMethod.trim()}\n` : ''}

User wants to: ${aiInput}`;

      const raw = await callAI(aiConfig, enhancedInput, {
        webSearch: aiConfig.webSearchEnabled,
        searchQuery: aiInput,
      });
      const parsed = normalizeAIResponse(parseAIResponse(raw));

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
          energyLevel: t.energyLevel,
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
        showToast(`Skipped ${skippedCycles} invalid dependencies`);
      }

      // Navigate to the project we just added to
      if (parentId !== INBOX_ID) {
        goToProject(parentId);
      }

      setAiInput('');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'AI breakdown failed', 'error');
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
          {aiConfig.apiKey ? (
            <div className="ai-input-group">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStartAI()}
                placeholder="Break down a goal with AI..."
                className="ai-input"
                disabled={aiFlowStep === 'loading'}
              />
              <button
                onClick={handleStartAI}
                disabled={!aiInput.trim() || aiFlowStep === 'loading'}
                className="ai-btn"
              >
                {aiFlowStep === 'loading' ? '...' : 'Break Down'}
              </button>
            </div>
          ) : (
            <button onClick={openSettings} className="ai-setup-btn">Set up AI breakdown</button>
          )}
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={formWebSearchEnabled}
                onChange={(e) => setFormWebSearchEnabled(e.target.checked)}
              />
              <span>Use web search when available</span>
            </label>
            {formWebSearchEnabled && (
              <>
                <label className="field-label">Search Provider</label>
                <div className="provider-options">
                  <button
                    onClick={() => setFormSearchProvider('tavily')}
                    className={`provider-btn ${formSearchProvider === 'tavily' ? 'provider-btn-active' : ''}`}
                  >
                    Tavily
                  </button>
                  <button
                    onClick={() => setFormSearchProvider('openai')}
                    className={`provider-btn ${formSearchProvider === 'openai' ? 'provider-btn-active' : ''}`}
                  >
                    OpenAI
                  </button>
                </div>
                {formSearchProvider === 'tavily' ? (
                  <>
                    <label className="field-label">Tavily API Key</label>
                    <input
                      type="password"
                      value={formTavilyApiKey}
                      onChange={(e) => setFormTavilyApiKey(e.target.value)}
                      placeholder="tvly-... or TAVILY_API_KEY in dev server"
                      className="field-input"
                    />
                    <p className="field-hint">Search first improves the planning prompt, then a separate AI call returns the final JSON. Tavily requests go through the local Vite proxy to avoid browser CORS issues.</p>
                    <label className="field-label">Tavily Results</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={formTavilyMaxResults}
                      onChange={(e) => setFormTavilyMaxResults(e.target.value)}
                      className="field-input mono"
                    />
                  </>
                ) : (
                  <p className="field-hint">OpenAI search uses the Responses API web_search tool and requires OpenAI as the AI provider.</p>
                )}
              </>
            )}
            {formProvider === 'deepseek' && <p className="field-hint">DeepSeek uses OpenAI-compatible API.</p>}
            {formProvider === 'custom' && <p className="field-hint">Any OpenAI-compatible endpoint.</p>}

            <label className="field-label">Workspace Memory</label>
            <textarea
              value={formMemory}
              onChange={(e) => setFormMemory(e.target.value)}
              rows={5}
              className="field-input field-textarea"
              placeholder="Persistent preferences, project constraints, personal context, recurring goals..."
            />
            <p className="field-hint">AI breakdowns include this local memory plus a fresh summary of current todos.</p>

            <label className="field-label">Planning Method</label>
            <textarea
              value={formPlanningMethod}
              onChange={(e) => setFormPlanningMethod(e.target.value)}
              rows={5}
              className="field-input field-textarea"
              placeholder="How AI should refine schedules: grouping rules, target task size, dependency style, daily planning habits..."
            />
            <p className="field-hint">Project replanning follows this method when redesigning todos and nested tasks.</p>
            <div className="modal-actions">
              <button onClick={() => setShowSettings(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveSettings} className="btn-primary">Save</button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

            <label className="field-label">Data</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={exportAll} className="btn-secondary" style={{ flex: 1 }}>Export All</button>
              <button onClick={() => fileInputRef.current?.click()} className="btn-secondary" style={{ flex: 1 }}>Import</button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = startImport(reader.result as string);
                  if (!result.valid) {
                    showToast(result.errors.join('. '), 'error');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
