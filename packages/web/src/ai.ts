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

export function parseAIResponse(raw: string): AIParsedResponse {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
}
