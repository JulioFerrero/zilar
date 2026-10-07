import { API_URL } from './auth';

/**
 * The AI memory API (`GET /api/ai-memory`, `DELETE /api/ai-memory/facts/:id`
 * and `POST /api/ai-memory/clear`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/agents/memory/routes.ts`.
 *
 * Mobile validates the boundary with type guards, like `audit-api.ts`.
 * `AiMemoryApiError` keeps the server's `code` and `status`, so the section
 * can show fixed user-facing sentences instead of server text.
 */

export interface AiMemoryFact {
  id: string;
  text: string;
}

export interface AiMemory {
  facts: AiMemoryFact[];
  lines: string[];
  canChange: boolean;
}

export interface AiMemoryApi {
  getMemory(chat: string, aiId: string): Promise<AiMemory>;
  forgetFact(chat: string, aiId: string, factId: string): Promise<void>;
  clear(chat: string, aiId: string): Promise<void>;
}

export class AiMemoryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AiMemoryApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseFact(value: unknown): AiMemoryFact | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const text = value['text'];
  if (!isString(id) || !isString(text)) return null;
  return { id, text };
}

function parseAiMemory(value: unknown): AiMemory | null {
  if (!isRecord(value)) return null;
  const facts = value['facts'];
  const lines = value['lines'];
  const canChange = value['canChange'];
  if (!Array.isArray(facts) || !Array.isArray(lines) || typeof canChange !== 'boolean') return null;
  const parsedFacts: AiMemoryFact[] = [];
  for (const item of facts) {
    const fact = parseFact(item);
    if (fact === null) return null;
    parsedFacts.push(fact);
  }
  const parsedLines: string[] = [];
  for (const line of lines) {
    if (!isString(line)) return null;
    parsedLines.push(line);
  }
  return { facts: parsedFacts, lines: parsedLines, canChange };
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new AiMemoryApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new AiMemoryApiError(response.status, code, message);
  }
  return body;
}

/** The production `AiMemoryApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAiMemoryApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiMemoryApi {
  async function requireToken(): Promise<string> {
    const token = await getToken();
    if (token === undefined) {
      throw new AiMemoryApiError(401, 'unauthorized', 'No session');
    }
    return token;
  }

  return {
    async getMemory(chat, aiId) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('ai', aiId);
      const token = await requireToken();
      const body = await request(
        apiUrl,
        `/api/ai-memory?${params.toString()}`,
        token,
        { method: 'GET' },
        fetchImpl,
      );
      const parsed = parseAiMemory(body);
      if (parsed === null) {
        throw new AiMemoryApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return parsed;
    },

    async forgetFact(chat, aiId, factId) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('ai', aiId);
      const token = await requireToken();
      await request(
        apiUrl,
        `/api/ai-memory/facts/${encodeURIComponent(factId)}?${params.toString()}`,
        token,
        { method: 'DELETE' },
        fetchImpl,
      );
    },

    async clear(chat, aiId) {
      const token = await requireToken();
      await request(
        apiUrl,
        '/api/ai-memory/clear',
        token,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat, ai: aiId }),
        },
        fetchImpl,
      );
    },
  };
}
