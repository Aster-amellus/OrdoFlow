import type { Dependency, EnergyLevel, Task } from '@ordoflow/core';
import { calculateProgress } from '@ordoflow/core';

export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'custom';
export type AISearchProvider = 'openai' | 'tavily';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  webSearchEnabled?: boolean;
  searchProvider?: AISearchProvider;
  tavilyApiKey?: string;
  tavilyMaxResults?: number;
}

export const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string; label: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    label: 'Anthropic',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    label: 'DeepSeek',
  },
  custom: {
    baseUrl: '',
    model: '',
    label: 'Custom (OpenAI-compatible)',
  },
};

const SYSTEM_PROMPT = `Break down a goal into tasks with dependencies. You may organize tasks into folders.

Return JSON:
{
  "folders": [{ "name": "folder name" }],
  "tasks": [
    { "title": "...", "estimatedMinutes": N, "energyLevel": "high|medium|low", "folder": "folder name or null" }
  ],
  "dependencies": [{ "from": "...", "to": "..." }]
}

Rules:
- "folders" is optional. Only create folders if tasks naturally group into categories.
- Each task's "folder" field must match a name in "folders", or null/omit for no folder.
- No cycles in dependencies.
- Task titles must be unique.
- Only return JSON, no markdown fences.`;

const PROMPT_OPTIMIZER_SYSTEM_PROMPT = `You optimize an OrdoFlow planning prompt before a separate final model call.

Return JSON:
{
  "optimizedPrompt": "the complete improved prompt to send to the final planning model"
}

Rules:
- Do not generate todos, tasks, dependencies, or patches yourself.
- Preserve all output schema instructions, exact task ids, project ids, constraints, and user planning method from the original prompt.
- Use search results only to clarify requirements, add missing external facts, add source URLs, and make the final prompt more precise.
- If search results are irrelevant, keep the original intent and say they were not relevant inside the optimized prompt.
- The optimized prompt must ask the final model to produce the requested JSON artifact, not a narrative answer.
- Only return JSON, no markdown fences.`;

export interface AICallOptions {
  systemPrompt?: string;
  webSearch?: boolean;
  searchQuery?: string;
}

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  answer?: string;
  results?: TavilySearchResult[];
}

function extractResponseText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('\n');
}

async function callOpenAIResponses(config: AIConfig, userMessage: string, systemPrompt: string): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/responses`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      instructions: systemPrompt,
      input: userMessage,
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return extractResponseText(data);
}

function clampTavilyMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.round(value || 5)));
}

async function searchTavily(config: AIConfig, query: string): Promise<string> {
  const apiKey = config.tavilyApiKey?.trim();

  const res = await fetch('/api/tavily/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: clampTavilyMaxResults(config.tavilyMaxResults),
      include_answer: true,
      include_raw_content: false,
      include_images: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) {
      throw new Error('Tavily search proxy is unavailable. Run the app through Vite dev or preview.');
    }
    throw new Error(`Tavily error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as TavilySearchResponse;
  const lines = [`Tavily web search results for: ${query}`];
  if (data.answer) {
    lines.push('');
    lines.push(`Answer: ${data.answer}`);
  }

  const results = Array.isArray(data.results) ? data.results.slice(0, clampTavilyMaxResults(config.tavilyMaxResults)) : [];
  if (results.length > 0) {
    lines.push('');
    lines.push('Sources:');
    results.forEach((result, index) => {
      const title = result.title || result.url || `Result ${index + 1}`;
      const url = result.url || '';
      const published = result.published_date ? ` (${result.published_date})` : '';
      const content = result.content ? `\n${result.content.slice(0, 700)}` : '';
      lines.push(`${index + 1}. ${title}${published}\n${url}${content}`);
    });
  }

  return lines.join('\n');
}

function appendSearchResults(userMessage: string, searchResults: string): string {
  return `${userMessage}

Use these web search results when they are relevant. Preserve source URLs in any "sources" JSON fields when the schema provides them.

${searchResults}`;
}

function buildPromptOptimizerInput(userMessage: string, searchResults: string | null): string {
  const searchBlock = searchResults
    ? `Search results to use for prompt optimization:\n${searchResults}`
    : 'Use web search if external/current facts would improve the final planning prompt.';
  return `Original final-generation prompt:
${userMessage}

${searchBlock}

Rewrite the original prompt into a stronger final-generation prompt. Preserve the requested output shape and exact ids.`;
}

function parseOptimizedPrompt(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  if (!cleaned) return fallback;
  try {
    const parsed = JSON.parse(cleaned) as { optimizedPrompt?: unknown; prompt?: unknown };
    const optimized = typeof parsed.optimizedPrompt === 'string' ? parsed.optimizedPrompt : parsed.prompt;
    if (typeof optimized === 'string' && optimized.trim()) return optimized.trim();
  } catch {}
  return cleaned;
}

async function callAIWithoutSearch(config: AIConfig, userMessage: string, options?: AICallOptions): Promise<string> {
  const finalOptions = { ...options, webSearch: false };
  if (config.provider === 'anthropic') {
    return callAnthropic(config, userMessage, finalOptions);
  }
  return callOpenAICompatible(config, userMessage, finalOptions);
}

async function optimizePromptWithSearch(config: AIConfig, userMessage: string, options: AICallOptions): Promise<string> {
  const searchProvider = config.searchProvider || 'tavily';
  const searchQuery = (options.searchQuery || userMessage).trim().slice(0, 500);
  if (!searchQuery) return userMessage;

  if (searchProvider === 'openai') {
    if (config.provider !== 'openai') {
      throw new Error('OpenAI web search requires OpenAI as the AI provider');
    }
    const raw = await callOpenAIResponses(
      config,
      buildPromptOptimizerInput(userMessage, null),
      PROMPT_OPTIMIZER_SYSTEM_PROMPT
    );
    return parseOptimizedPrompt(raw, userMessage);
  }

  const searchResults = await searchTavily(config, searchQuery);
  const raw = await callAIWithoutSearch(
    config,
    buildPromptOptimizerInput(userMessage, searchResults),
    { systemPrompt: PROMPT_OPTIMIZER_SYSTEM_PROMPT }
  );
  return parseOptimizedPrompt(raw, appendSearchResults(userMessage, searchResults));
}

async function callOpenAICompatible(config: AIConfig, userMessage: string, options?: AICallOptions): Promise<string> {
  const systemPrompt = options?.systemPrompt || SYSTEM_PROMPT;
  const searchProvider = config.searchProvider || 'tavily';
  if (options?.webSearch && searchProvider === 'openai' && config.provider === 'openai') {
    return callOpenAIResponses(config, userMessage, systemPrompt);
  }

  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(config: AIConfig, userMessage: string, options?: AICallOptions): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: options?.systemPrompt || SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

export async function callAI(config: AIConfig, userMessage: string, options?: AICallOptions): Promise<string> {
  if (options?.webSearch) {
    const optimizedPrompt = await optimizePromptWithSearch(config, userMessage, options);
    return callAIWithoutSearch(config, optimizedPrompt, options);
  }

  return callAIWithoutSearch(config, userMessage, options);
}

export interface AITaskResult {
  title: string;
  estimatedMinutes?: number;
  energyLevel?: string;
  folder?: string | null;
}

export interface AIFolderResult {
  name: string;
}

export interface AIParsedResponse {
  folders?: AIFolderResult[];
  tasks: AITaskResult[];
  dependencies?: { from: string; to: string }[];
}

export interface NormalizedAITaskResult {
  title: string;
  estimatedMinutes?: number;
  energyLevel?: EnergyLevel;
  folder?: string | null;
}

export interface NormalizedAIParsedResponse {
  folders: AIFolderResult[];
  tasks: NormalizedAITaskResult[];
  dependencies: { from: string; to: string }[];
}

export interface AIPlanTaskResult extends AITaskResult {
  description?: string;
  tasks?: AIPlanTaskResult[];
}

export interface AISourceResult {
  title?: string;
  url: string;
}

export interface AIProjectPlanResponse {
  projectTitle?: string;
  projectDescription?: string;
  todos?: AIPlanTaskResult[];
  dependencies?: { from: string; to: string }[];
  sources?: AISourceResult[];
}

export interface NormalizedAIPlanTask {
  title: string;
  description?: string;
  estimatedMinutes?: number;
  energyLevel?: EnergyLevel;
  tasks: NormalizedAIPlanTask[];
}

export interface NormalizedAIProjectPlanResponse {
  projectTitle?: string;
  projectDescription?: string;
  todos: NormalizedAIPlanTask[];
  dependencies: { from: string; to: string }[];
  sources: AISourceResult[];
}

type AITaskPatchOp =
  | {
      type: 'insert';
      key: string;
      title: string;
      parentId: string;
      afterId?: string | null;
      description?: string;
      estimatedMinutes?: number;
      energyLevel?: string;
    }
  | {
      type: 'update';
      targetId: string;
      title?: string;
      description?: string;
      estimatedMinutes?: number;
      energyLevel?: string;
    }
  | {
      type: 'delete';
      targetId: string;
    }
  | {
      type: 'move';
      targetId: string;
      parentId: string;
      afterId?: string | null;
    };

type AIDependencyPatchOp =
  | { type: 'add'; fromId: string; toId: string }
  | { type: 'remove'; fromId: string; toId: string };

export interface AIProjectPatchResponse {
  projectTitle?: string;
  projectDescription?: string;
  taskOperations?: AITaskPatchOp[];
  dependencyOperations?: AIDependencyPatchOp[];
  sources?: AISourceResult[];
}

export type NormalizedTaskPatchOperation =
  | {
      type: 'insert';
      key: string;
      title: string;
      parentId: string;
      afterId?: string | null;
      description?: string;
      estimatedMinutes?: number;
      energyLevel?: EnergyLevel;
    }
  | {
      type: 'update';
      targetId: string;
      title?: string;
      description?: string;
      estimatedMinutes?: number;
      energyLevel?: EnergyLevel;
    }
  | {
      type: 'delete';
      targetId: string;
    }
  | {
      type: 'move';
      targetId: string;
      parentId: string;
      afterId?: string | null;
    };

export type NormalizedDependencyPatchOperation =
  | { type: 'add'; fromId: string; toId: string }
  | { type: 'remove'; fromId: string; toId: string };

export interface NormalizedAIProjectPatchResponse {
  projectTitle?: string;
  projectDescription?: string;
  taskOperations: NormalizedTaskPatchOperation[];
  dependencyOperations: NormalizedDependencyPatchOperation[];
  sources: AISourceResult[];
}

export const PROJECT_REPLAN_SYSTEM_PROMPT = `Redesign one OrdoFlow project into project-level todos and concrete tasks.

Return JSON:
{
  "projectTitle": "project title",
  "projectDescription": "short project requirement summary",
  "todos": [
    {
      "title": "todo outcome",
      "description": "what this todo accomplishes",
      "estimatedMinutes": N,
      "energyLevel": "high|medium|low",
      "tasks": [
        { "title": "concrete task", "description": "...", "estimatedMinutes": N, "energyLevel": "high|medium|low" }
      ]
    }
  ],
  "dependencies": [{ "from": "todo or task title", "to": "todo or task title" }],
  "sources": [{ "title": "source title", "url": "https://..." }]
}

Rules:
- Treat "todos" as the project plan; treat nested "tasks" as execution steps under each todo.
- Follow the user's planning method exactly.
- Use web search only when it helps with current requirements, examples, APIs, market facts, schedules, or other external facts.
- If web search is used, put source links in "sources". Do not include markdown citations in task titles.
- Titles across todos and nested tasks must be unique so dependencies can refer to them.
- No cycles in dependencies.
- Keep tasks actionable and small enough to schedule.
- Only return JSON, no markdown fences.`;

export const PROJECT_PATCH_SYSTEM_PROMPT = `Edit one existing OrdoFlow project by returning a constrained patch for its task tree and dependency tree.

Return JSON:
{
  "projectTitle": "optional updated project title",
  "projectDescription": "optional updated project description",
  "taskOperations": [
    { "type": "insert", "key": "new-temp-key", "title": "new task", "parentId": "existing parent task id", "afterId": "optional sibling id", "description": "...", "estimatedMinutes": N, "energyLevel": "high|medium|low" },
    { "type": "update", "targetId": "existing task id", "title": "optional new title", "description": "optional description", "estimatedMinutes": N, "energyLevel": "high|medium|low" },
    { "type": "delete", "targetId": "existing task id" },
    { "type": "move", "targetId": "existing task id", "parentId": "existing parent task id", "afterId": "optional sibling id" }
  ],
  "dependencyOperations": [
    { "type": "add", "fromId": "existing task id or inserted key", "toId": "existing task id or inserted key" },
    { "type": "remove", "fromId": "existing task id", "toId": "existing task id" }
  ],
  "sources": [{ "title": "source title", "url": "https://..." }]
}

Rules:
- Prefer patch operations when the user asks for restructuring, inserting, deleting, or changing dependencies without replacing the whole plan.
- Use exact task ids from the provided context for existing tasks.
- For inserted tasks, invent a unique "key" and use that key in later move/dependency operations if needed.
- Do not delete or move the project root. Do not touch the inbox.
- Keep operations minimal and directly tied to the requested redesign.
- Do not create dependency cycles.
- If web search is used, put source links in "sources".
- Only return JSON, no markdown fences.`;

export function parseAIResponse<T = AIParsedResponse>(raw: string): T {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned) as T;
}

export function normalizeAIResponse(parsed: AIParsedResponse): NormalizedAIParsedResponse {
  if (!Array.isArray(parsed.tasks)) throw new Error('AI response must include a tasks array');

  const folders = Array.isArray(parsed.folders)
    ? parsed.folders
        .map(f => ({ name: String(f.name || '').trim() }))
        .filter(f => f.name.length > 0)
    : [];

  const tasks: NormalizedAITaskResult[] = [];
  for (const task of parsed.tasks) {
      const title = String(task.title || '').trim();
      if (!title) continue;
      const minutes = Number(task.estimatedMinutes);
      const energy = task.energyLevel;
      const normalized: NormalizedAITaskResult = {
        title,
      };
      if (Number.isFinite(minutes) && minutes > 0) normalized.estimatedMinutes = Math.round(minutes);
      if (energy === 'high' || energy === 'medium' || energy === 'low') normalized.energyLevel = energy;
      normalized.folder = task.folder ? String(task.folder).trim() : null;
      tasks.push(normalized);
  }

  const knownTitles = new Set(tasks.map(task => task.title));
  const dependencies = Array.isArray(parsed.dependencies)
    ? parsed.dependencies
        .map(dep => ({ from: String(dep.from || '').trim(), to: String(dep.to || '').trim() }))
        .filter(dep => knownTitles.has(dep.from) && knownTitles.has(dep.to) && dep.from !== dep.to)
    : [];

  return { folders, tasks, dependencies };
}

function normalizePlanTask(task: AIPlanTaskResult, titles: Set<string>): NormalizedAIPlanTask | null {
  const title = String(task.title || '').trim();
  if (!title) return null;
  if (titles.has(title)) throw new Error(`AI response has duplicate title "${title}"`);
  titles.add(title);

  const minutes = Number(task.estimatedMinutes);
  const energy = task.energyLevel;
  const normalized: NormalizedAIPlanTask = {
    title,
    tasks: [],
  };
  const description = String(task.description || '').trim();
  if (description) normalized.description = description;
  if (Number.isFinite(minutes) && minutes > 0) normalized.estimatedMinutes = Math.round(minutes);
  if (energy === 'high' || energy === 'medium' || energy === 'low') normalized.energyLevel = energy;
  if (Array.isArray(task.tasks)) {
    normalized.tasks = task.tasks
      .map(child => normalizePlanTask(child, titles))
      .filter((child): child is NormalizedAIPlanTask => child !== null);
  }
  return normalized;
}

export function normalizeAIProjectPlanResponse(parsed: AIProjectPlanResponse): NormalizedAIProjectPlanResponse {
  if (!Array.isArray(parsed.todos)) throw new Error('AI response must include a todos array');

  const titles = new Set<string>();
  const todos = parsed.todos
    .map(todo => normalizePlanTask(todo, titles))
    .filter((todo): todo is NormalizedAIPlanTask => todo !== null);

  const dependencies = Array.isArray(parsed.dependencies)
    ? parsed.dependencies
        .map(dep => ({ from: String(dep.from || '').trim(), to: String(dep.to || '').trim() }))
        .filter(dep => titles.has(dep.from) && titles.has(dep.to) && dep.from !== dep.to)
    : [];

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map(source => ({
          title: String(source.title || '').trim() || undefined,
          url: String(source.url || '').trim(),
        }))
        .filter(source => source.url.length > 0)
    : [];

  const projectTitle = String(parsed.projectTitle || '').trim() || undefined;
  const projectDescription = String(parsed.projectDescription || '').trim() || undefined;

  return { projectTitle, projectDescription, todos, dependencies, sources };
}

function normalizeEnergyLevel(value: unknown): EnergyLevel | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

function normalizeMinutes(value: unknown): number | undefined {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizePatchRef(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

export function normalizeAIProjectPatchResponse(parsed: AIProjectPatchResponse): NormalizedAIProjectPatchResponse {
  const taskOperations: NormalizedTaskPatchOperation[] = [];

  if (Array.isArray(parsed.taskOperations)) {
    for (const op of parsed.taskOperations) {
      if (!op || typeof op !== 'object') continue;
      if (op.type === 'insert') {
        const key = normalizePatchRef(op.key);
        const title = normalizeOptionalString(op.title);
        const parentId = normalizePatchRef(op.parentId);
        if (!key || !title || !parentId) continue;
        const normalized: NormalizedTaskPatchOperation = {
          type: 'insert',
          key,
          title,
          parentId,
        };
        const afterId = normalizePatchRef(op.afterId);
        const description = normalizeOptionalString(op.description);
        const estimatedMinutes = normalizeMinutes(op.estimatedMinutes);
        const energyLevel = normalizeEnergyLevel(op.energyLevel);
        if (afterId) normalized.afterId = afterId;
        if (description) normalized.description = description;
        if (estimatedMinutes) normalized.estimatedMinutes = estimatedMinutes;
        if (energyLevel) normalized.energyLevel = energyLevel;
        taskOperations.push(normalized);
      } else if (op.type === 'update') {
        const targetId = normalizePatchRef(op.targetId);
        if (!targetId) continue;
        const normalized: NormalizedTaskPatchOperation = { type: 'update', targetId };
        const title = normalizeOptionalString(op.title);
        const description = normalizeOptionalString(op.description);
        const estimatedMinutes = normalizeMinutes(op.estimatedMinutes);
        const energyLevel = normalizeEnergyLevel(op.energyLevel);
        if (title) normalized.title = title;
        if (description) normalized.description = description;
        if (estimatedMinutes) normalized.estimatedMinutes = estimatedMinutes;
        if (energyLevel) normalized.energyLevel = energyLevel;
        taskOperations.push(normalized);
      } else if (op.type === 'delete') {
        const targetId = normalizePatchRef(op.targetId);
        if (targetId) taskOperations.push({ type: 'delete', targetId });
      } else if (op.type === 'move') {
        const targetId = normalizePatchRef(op.targetId);
        const parentId = normalizePatchRef(op.parentId);
        if (!targetId || !parentId) continue;
        const normalized: NormalizedTaskPatchOperation = { type: 'move', targetId, parentId };
        const afterId = normalizePatchRef(op.afterId);
        if (afterId) normalized.afterId = afterId;
        taskOperations.push(normalized);
      }
    }
  }

  const dependencyOperations: NormalizedDependencyPatchOperation[] = [];
  if (Array.isArray(parsed.dependencyOperations)) {
    for (const op of parsed.dependencyOperations) {
      if (!op || typeof op !== 'object') continue;
      const fromId = normalizePatchRef(op.fromId);
      const toId = normalizePatchRef(op.toId);
      if (!fromId || !toId || fromId === toId) continue;
      if (op.type === 'add') dependencyOperations.push({ type: 'add', fromId, toId });
      else if (op.type === 'remove') dependencyOperations.push({ type: 'remove', fromId, toId });
    }
  }

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map(source => ({
          title: String(source.title || '').trim() || undefined,
          url: String(source.url || '').trim(),
        }))
        .filter(source => source.url.length > 0)
    : [];

  const projectTitle = String(parsed.projectTitle || '').trim() || undefined;
  const projectDescription = String(parsed.projectDescription || '').trim() || undefined;
  return { projectTitle, projectDescription, taskOperations, dependencyOperations, sources };
}

function collectTaskTitles(task: Task, taskTitles: Map<string, string>): void {
  taskTitles.set(task.id, task.title);
  task.subtasks.forEach(child => collectTaskTitles(child, taskTitles));
}

function collectTaskLines(
  task: Task,
  depth: number,
  lines: string[],
  dependencies: Dependency[],
  taskTitles: Map<string, string>
): void {
  const indent = '  '.repeat(depth);
  const progress = calculateProgress(task);
  const depsIn = dependencies
    .filter(dep => dep.toTaskId === task.id)
    .map(dep => taskTitles.get(dep.fromTaskId))
    .filter(Boolean);
  const estimate = progress.estimatedMinutesRemaining > 0 ? `, remaining ${progress.estimatedMinutesRemaining}m` : '';
  const depText = depsIn.length > 0 ? `, blocked by ${depsIn.join(', ')}` : '';
  lines.push(`${indent}- ${task.title} [${task.status}${estimate}${depText}]`);
  task.subtasks.slice(0, 8).forEach(child => collectTaskLines(child, depth + 1, lines, dependencies, taskTitles));
  if (task.subtasks.length > 8) lines.push(`${indent}  - ...${task.subtasks.length - 8} more`);
}

function collectTaskReferenceLines(task: Task, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  lines.push(`${indent}- id=${task.id}; title=${task.title}; status=${task.status}; minutes=${task.estimatedMinutes || 0}`);
  task.subtasks.forEach(child => collectTaskReferenceLines(child, depth + 1, lines));
}

export function buildAIWorkspaceContext(
  root: Task,
  inbox: Task,
  dependencies: Dependency[],
  memory: string
): string {
  const lines: string[] = [];
  const taskTitles = new Map<string, string>();
  collectTaskTitles(root, taskTitles);
  collectTaskTitles(inbox, taskTitles);
  const trimmedMemory = memory.trim();
  if (trimmedMemory) {
    lines.push('Local workspace memory:');
    lines.push(trimmedMemory);
    lines.push('');
  }

  lines.push('Current todos:');
  lines.push('Inbox:');
  inbox.subtasks.slice(0, 12).forEach(task => collectTaskLines(task, 1, lines, dependencies, taskTitles));
  if (inbox.subtasks.length === 0) lines.push('  - empty');
  if (inbox.subtasks.length > 12) lines.push(`  - ...${inbox.subtasks.length - 12} more`);

  lines.push('Projects:');
  root.subtasks.slice(0, 12).forEach(project => collectTaskLines(project, 1, lines, dependencies, taskTitles));
  if (root.subtasks.length === 0) lines.push('  - empty');
  if (root.subtasks.length > 12) lines.push(`  - ...${root.subtasks.length - 12} more`);

  return lines.join('\n');
}

export function buildProjectPlanningContext(
  project: Task,
  root: Task,
  inbox: Task,
  dependencies: Dependency[],
  memory: string,
  planningMethod: string
): string {
  const workspaceContext = buildAIWorkspaceContext(root, inbox, dependencies, memory);
  const lines: string[] = [workspaceContext, ''];
  const trimmedMethod = planningMethod.trim();
  if (trimmedMethod) {
    lines.push('User planning method:');
    lines.push(trimmedMethod);
    lines.push('');
  }
  lines.push('Project to redesign:');
  lines.push(`Title: ${project.title}`);
  lines.push(`Description: ${project.description || 'none'}`);
  lines.push('Current project todos/tasks:');
  const taskTitles = new Map<string, string>();
  collectTaskTitles(project, taskTitles);
  if (project.subtasks.length === 0) {
    lines.push('- empty');
  } else {
    project.subtasks.forEach(task => collectTaskLines(task, 0, lines, dependencies, taskTitles));
  }
  return lines.join('\n');
}

export function buildProjectPatchContext(
  project: Task,
  root: Task,
  inbox: Task,
  dependencies: Dependency[],
  memory: string,
  planningMethod: string
): string {
  const workspaceContext = buildAIWorkspaceContext(root, inbox, dependencies, memory);
  const lines: string[] = [workspaceContext, ''];
  const trimmedMethod = planningMethod.trim();
  if (trimmedMethod) {
    lines.push('User planning method:');
    lines.push(trimmedMethod);
    lines.push('');
  }

  lines.push('Editable project tree with exact ids:');
  lines.push(`- id=${project.id}; title=${project.title}; this is the project root and must not be deleted or moved`);
  project.subtasks.forEach(task => collectTaskReferenceLines(task, 1, lines));
  if (project.subtasks.length === 0) lines.push('  - empty');

  const externalProjects = root.subtasks.filter(candidate => candidate.id !== project.id);
  lines.push('');
  lines.push('External project task ids available only for dependency endpoints:');
  if (externalProjects.length === 0) {
    lines.push('- none');
  } else {
    externalProjects.slice(0, 8).forEach(externalProject => collectTaskReferenceLines(externalProject, 0, lines));
    if (externalProjects.length > 8) lines.push(`- ...${externalProjects.length - 8} more external projects`);
  }

  lines.push('');
  lines.push('Current dependencies involving this project:');
  const projectIds = new Set<string>();
  const collectIds = (task: Task) => {
    projectIds.add(task.id);
    task.subtasks.forEach(collectIds);
  };
  collectIds(project);
  const taskTitles = new Map<string, string>();
  collectTaskTitles(root, taskTitles);
  collectTaskTitles(inbox, taskTitles);
  const relevantDeps = dependencies.filter(dep => projectIds.has(dep.fromTaskId) || projectIds.has(dep.toTaskId));
  if (relevantDeps.length === 0) {
    lines.push('- none');
  } else {
    relevantDeps.forEach(dep => {
      lines.push(`- ${dep.id}: ${dep.fromTaskId} (${taskTitles.get(dep.fromTaskId) || '?'}) -> ${dep.toTaskId} (${taskTitles.get(dep.toTaskId) || '?'})`);
    });
  }

  return lines.join('\n');
}
