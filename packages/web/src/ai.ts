import type { Dependency, EnergyLevel, Task } from '@ordoflow/core';
import { calculateProgress } from '@ordoflow/core';

export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
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

async function callOpenAICompatible(config: AIConfig, userMessage: string): Promise<string> {
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
        { role: 'system', content: SYSTEM_PROMPT },
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

async function callAnthropic(config: AIConfig, userMessage: string): Promise<string> {
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
      system: SYSTEM_PROMPT,
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

export async function callAI(config: AIConfig, userMessage: string): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, userMessage);
  }
  return callOpenAICompatible(config, userMessage);
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

export function parseAIResponse(raw: string): AIParsedResponse {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
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
