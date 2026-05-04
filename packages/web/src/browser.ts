import type { AIConfig } from './ai';
import { PROVIDER_DEFAULTS } from './ai';
import type { Task, Dependency } from '@ordoflow/core';

export const DATA_STORAGE_KEY = 'ordoflow-data';
export const AI_CONFIG_STORAGE_KEY = 'ordoflow-ai-config';
export const MEMORY_STORAGE_KEY = 'ordoflow-memory';
export const PLANNING_METHOD_STORAGE_KEY = 'ordoflow-planning-method';

export type RouteState =
  | { view: 'board'; projectId: null }
  | { view: 'project'; projectId: string };

export function parseRoute(path: string): RouteState {
  const match = path.match(/^\/project\/(.+)$/);
  if (match) return { view: 'project', projectId: decodeURIComponent(match[1]) };
  return { view: 'board', projectId: null };
}

export function pushRoute(route: RouteState): void {
  const path = route.view === 'project' ? `/project/${encodeURIComponent(route.projectId)}` : '/';
  window.history.pushState(null, '', path);
}

export function showToast(message: string, type: 'info' | 'error' = 'info'): void {
  window.dispatchEvent(new CustomEvent('ordoflow-toast', { detail: { message, type } }));
}

export function downloadTextFile(filename: string, contents: string, type = 'application/json'): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function loadAIConfig(): AIConfig {
  try {
    const saved = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<AIConfig>;
      return {
        provider: parsed.provider || 'openai',
        apiKey: parsed.apiKey || '',
        baseUrl: parsed.baseUrl || PROVIDER_DEFAULTS.openai.baseUrl,
        model: parsed.model || PROVIDER_DEFAULTS.openai.model,
        webSearchEnabled: parsed.webSearchEnabled || false,
        searchProvider: parsed.searchProvider || 'tavily',
        tavilyApiKey: parsed.tavilyApiKey || '',
        tavilyMaxResults: parsed.tavilyMaxResults || 5,
      };
    }
  } catch {}
  return {
    provider: 'openai',
    apiKey: '',
    baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
    model: PROVIDER_DEFAULTS.openai.model,
    webSearchEnabled: false,
    searchProvider: 'tavily',
    tavilyApiKey: '',
    tavilyMaxResults: 5,
  };
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function loadWorkspaceMemory(): string {
  try {
    return localStorage.getItem(MEMORY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveWorkspaceMemory(memory: string): void {
  localStorage.setItem(MEMORY_STORAGE_KEY, memory);
}

export function loadPlanningMethod(): string {
  try {
    return localStorage.getItem(PLANNING_METHOD_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function savePlanningMethod(method: string): void {
  localStorage.setItem(PLANNING_METHOD_STORAGE_KEY, method);
}

export function loadStoredData(): { root?: Task; inbox?: Task; dependencies?: Dependency[] } | null {
  const saved = localStorage.getItem(DATA_STORAGE_KEY);
  if (!saved) return null;
  return JSON.parse(saved) as { root?: Task; inbox?: Task; dependencies?: Dependency[] };
}

export function saveStoredData(data: { root: Task; inbox: Task; dependencies: Dependency[] }): void {
  localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(data));
}
