import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TAVILY_PROXY_PATH = '/api/tavily/search';

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body is too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function handleTavilySearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    writeJson(res, 401, { error: 'Missing Tavily API key. Configure it in settings or set TAVILY_API_KEY.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const upstream = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    res.end(text);
  } catch (err) {
    writeJson(res, 502, { error: err instanceof Error ? err.message : 'Tavily proxy failed' });
  }
}

function tavilyProxyPlugin(): Plugin {
  return {
    name: 'ordoflow-tavily-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(TAVILY_PROXY_PATH, (req, res) => {
        void handleTavilySearch(req, res);
      });
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(TAVILY_PROXY_PATH, (req, res) => {
        void handleTavilySearch(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tavilyProxyPlugin()],
  server: {
    port: 3000,
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
