import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { Dependency, Task } from '@ordoflow/core';
import { createTask } from '@ordoflow/core';
import {
  PROJECT_PATCH_SYSTEM_PROMPT,
  PROJECT_REPLAN_SYSTEM_PROMPT,
  buildProjectPatchContext,
  buildProjectPlanningContext,
  callAI,
  normalizeAIProjectPatchResponse,
  normalizeAIProjectPlanResponse,
  parseAIResponse,
  type AIProjectPatchResponse,
  type AIProjectPlanResponse,
  type NormalizedAIPlanTask,
  type NormalizedAIProjectPlanResponse,
} from '../ai';
import { showToast } from '../browser';
import { useStore } from '../store';

interface ProjectPlannerProps {
  project: Task;
}

type ApplyMode = 'replace' | 'patch' | 'append';
type Granularity = 'high' | 'medium' | 'detailed';

const GRANULARITY_PROMPTS: Record<Granularity, string> = {
  high: 'Design 3-5 project-level todos. Each todo may have 1-3 concrete tasks.',
  medium: 'Design 5-8 project-level todos. Each todo should have 2-5 concrete tasks.',
  detailed: 'Design 8-12 project-level todos. Each todo should have 3-7 small concrete tasks.',
};

function createTaskTree(planTask: NormalizedAIPlanTask, titleMap: Map<string, string>): Task {
  const id = nanoid();
  titleMap.set(planTask.title, id);
  return createTask(planTask.title, {
    id,
    description: planTask.description,
    estimatedMinutes: planTask.estimatedMinutes,
    energyLevel: planTask.energyLevel,
    subtasks: planTask.tasks.map(child => createTaskTree(child, titleMap)),
  });
}

function createDependencies(
  plan: NormalizedAIProjectPlanResponse,
  titleMap: Map<string, string>
): Dependency[] {
  return plan.dependencies
    .map(dep => {
      const fromTaskId = titleMap.get(dep.from);
      const toTaskId = titleMap.get(dep.to);
      if (!fromTaskId || !toTaskId) return null;
      return { id: nanoid(), fromTaskId, toTaskId };
    })
    .filter((dep): dep is Dependency => dep !== null);
}

function buildProjectDescription(
  project: Task,
  plan: NormalizedAIProjectPlanResponse,
  request: string
): string | undefined {
  const parts: string[] = [];
  if (plan.projectDescription) parts.push(plan.projectDescription);
  else if (project.description) parts.push(project.description);
  if (request.trim()) parts.push(`Planning request:\n${request.trim()}`);
  if (plan.sources.length > 0) {
    parts.push(`AI research sources:\n${plan.sources.map(source => `- ${source.title || source.url}: ${source.url}`).join('\n')}`);
  }
  return parts.join('\n\n') || undefined;
}

export default function ProjectPlanner({ project }: ProjectPlannerProps) {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const dependencies = useStore((s) => s.dependencies);
  const aiConfig = useStore((s) => s.aiConfig);
  const workspaceMemory = useStore((s) => s.workspaceMemory);
  const planningMethod = useStore((s) => s.planningMethod);
  const addSubtask = useStore((s) => s.addSubtask);
  const addDependency = useStore((s) => s.addDependency);
  const replaceProjectPlan = useStore((s) => s.replaceProjectPlan);
  const applyProjectPatch = useStore((s) => s.applyProjectPatch);

  const [isOpen, setIsOpen] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [request, setRequest] = useState('');
  const [applyMode, setApplyMode] = useState<ApplyMode>('replace');
  const [granularity, setGranularity] = useState<Granularity>('medium');

  const openModal = () => {
    setRequest(project.description || '');
    setApplyMode('replace');
    setGranularity('medium');
    setIsOpen(true);
  };

  const appendPlan = (plan: NormalizedAIProjectPlanResponse) => {
    const titleMap = new Map<string, string>();
    const addNested = (parentId: string, planTask: NormalizedAIPlanTask) => {
      const task = addSubtask(parentId, planTask.title, {
        description: planTask.description,
        estimatedMinutes: planTask.estimatedMinutes,
        energyLevel: planTask.energyLevel,
      });
      titleMap.set(planTask.title, task.id);
      planTask.tasks.forEach(child => addNested(task.id, child));
    };

    plan.todos.forEach(todo => addNested(project.id, todo));
    let skippedDeps = 0;
    for (const dep of createDependencies(plan, titleMap)) {
      if (!addDependency(dep.fromTaskId, dep.toTaskId)) skippedDeps++;
    }
    return { addedDeps: plan.dependencies.length - skippedDeps, skippedDeps };
  };

  const replacePlan = (plan: NormalizedAIProjectPlanResponse) => {
    const titleMap = new Map<string, string>();
    const subtasks = plan.todos.map(todo => createTaskTree(todo, titleMap));
    const projectDeps = createDependencies(plan, titleMap);
    return replaceProjectPlan(project.id, subtasks, projectDeps, {
      title: plan.projectTitle || project.title,
      description: buildProjectDescription(project, plan, request),
    });
  };

  const patchPlan = async () => {
    const context = buildProjectPatchContext(project, root, inbox, dependencies, workspaceMemory, planningMethod);
    const prompt = `${context}

${GRANULARITY_PROMPTS[granularity]}

Additional or updated requirements:
${request.trim() || 'No additional requirements. Improve the current dependency tree and task tree with a minimal patch.'}

Return a minimal patch. Insert/delete/update/move tasks and add/remove dependencies only where needed.`;

    const raw = await callAI(aiConfig, prompt, {
      systemPrompt: PROJECT_PATCH_SYSTEM_PROMPT,
      webSearch: aiConfig.webSearchEnabled,
      searchQuery: `${project.title} ${request.trim()}`.trim(),
    });
    const patch = normalizeAIProjectPatchResponse(parseAIResponse<AIProjectPatchResponse>(raw));
    if (patch.taskOperations.length === 0 && patch.dependencyOperations.length === 0 && !patch.projectTitle && !patch.projectDescription) {
      throw new Error('AI returned no patch operations');
    }
    const result = applyProjectPatch(project.id, patch);
    if (!result) throw new Error('Project patch could not be applied');
    return result;
  };

  const generatePlan = async () => {
    const context = buildProjectPlanningContext(project, root, inbox, dependencies, workspaceMemory, planningMethod);
    const prompt = `${context}

${GRANULARITY_PROMPTS[granularity]}

Additional or updated requirements:
${request.trim() || 'No additional requirements. Re-evaluate the existing project and make the plan clearer and more schedulable.'}

Apply mode requested by the user: ${applyMode}.
Return the redesigned project plan now.`;

    const raw = await callAI(aiConfig, prompt, {
      systemPrompt: PROJECT_REPLAN_SYSTEM_PROMPT,
      webSearch: aiConfig.webSearchEnabled,
      searchQuery: `${project.title} ${request.trim()}`.trim(),
    });
    const plan = normalizeAIProjectPlanResponse(parseAIResponse<AIProjectPlanResponse>(raw));
    if (plan.todos.length === 0) throw new Error('AI returned no todos');

    const result = applyMode === 'replace' ? replacePlan(plan) : appendPlan(plan);
    if (!result) throw new Error('Project could not be updated');
    return { plan, result };
  };

  const handlePlan = async () => {
    if (!aiConfig.apiKey || isPlanning) return;
    setIsPlanning(true);
    try {
      if (applyMode === 'patch') {
        const result = await patchPlan();
        showToast(
          `AI patched tree: +${result.inserted} tasks, -${result.deleted}, ${result.moved} moved, +${result.addedDeps}/-${result.removedDeps} deps${result.skippedOps ? `, skipped ${result.skippedOps}` : ''}`
        );
      } else {
        const { plan, result } = await generatePlan();
        showToast(
          `AI planned ${plan.todos.length} todos${result.skippedDeps ? `, skipped ${result.skippedDeps} deps` : ''}`
        );
      }
      setIsOpen(false);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Project planning failed', 'error');
    } finally {
      setIsPlanning(false);
    }
  };

  if (!aiConfig.apiKey) return null;

  return (
    <>
      <button className="task-list-toolbar-btn task-list-toolbar-btn-accent" onClick={openModal}>
        Replan with AI
      </button>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Replan Project: {project.title}</h3>

            <label className="field-label">Requirements</label>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={5}
              className="field-input field-textarea"
              placeholder="Updated requirements, constraints, preferred schedule handling, research targets..."
            />

            <label className="field-label">Granularity</label>
            <div className="priority-options">
              {(['high', 'medium', 'detailed'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setGranularity(level)}
                  className={`priority-btn ${granularity === level ? 'priority-btn-active' : ''}`}
                >
                  {level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Detailed'}
                </button>
              ))}
            </div>

            <label className="field-label">Apply Mode</label>
            <div className="priority-options">
              <button
                onClick={() => setApplyMode('replace')}
                className={`priority-btn ${applyMode === 'replace' ? 'priority-btn-active' : ''}`}
              >
                Replace plan
              </button>
              <button
                onClick={() => setApplyMode('patch')}
                className={`priority-btn ${applyMode === 'patch' ? 'priority-btn-active' : ''}`}
              >
                Patch tree
              </button>
              <button
                onClick={() => setApplyMode('append')}
                className={`priority-btn ${applyMode === 'append' ? 'priority-btn-active' : ''}`}
              >
                Append
              </button>
            </div>
            {applyMode === 'replace' && (
              <p className="field-hint">Existing project todos and nested tasks are replaced. Project-level external dependencies are kept.</p>
            )}
            {applyMode === 'patch' && (
              <p className="field-hint">AI can insert, update, delete, move tasks, and add or remove dependencies with a minimal patch.</p>
            )}
            {aiConfig.webSearchEnabled && (
              <p className="field-hint">
                {aiConfig.searchProvider === 'openai'
                  ? 'OpenAI search will optimize the prompt before final planning.'
                  : 'Tavily search will optimize the prompt before final planning.'}
              </p>
            )}

            <div className="modal-actions">
              <button onClick={() => setIsOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handlePlan} className="btn-primary" disabled={isPlanning}>
                {isPlanning ? 'Planning...' : 'Generate Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
