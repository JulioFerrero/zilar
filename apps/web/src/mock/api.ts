import type { ChatEntry, Connection, Contact, Me, PublicAi } from '@/lib/api';
import { isMockApiEnabled } from './gate';
import { currentUserId, PEOPLE } from './ids';
import { mockChats } from './chats';
import { mockGroupDetails } from './groups';

/**
 * The standalone mock HTTP layer (T-0069). In mock mode the app needs no
 * server: `request()` in lib/api.ts answers from here, and a global fetch
 * wrapper (see `installMockFetch`) covers the few callers that still use
 * `fetch` directly. Data lives in memory for the page load only.
 */
export interface MockRequestOptions {
  delayMs?: number;
}

/** Matches the real server's usual latency, so loading states are exercised. */
const DEFAULT_DELAY_MS = 150;
let delayMs = DEFAULT_DELAY_MS;

/** Tests set 0 to keep the suite fast; the app keeps the realistic delay. */
export function setMockDelay(ms: number): void {
  delayMs = ms;
}

interface MockState {
  me: Me;
  ais: PublicAi[];
  connections: Connection[];
  nextAiSequence: number;
}

function seedAi(name: string, template: PublicAi['template'], id: string): PublicAi {
  return {
    id,
    name,
    template,
    persona: `${name} is a helpful assistant for the mock workspace.`,
    model: 'gpt-4o',
    jid: 'c-devai',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    usage: null,
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

function seedState(): MockState {
  return {
    me: {
      id: currentUserId,
      email: 'you@galena.test',
      name: 'You',
      image: null,
      jid: `${currentUserId}@galena.test`,
    },
    // Two AIs: one without usage, one at 85% of its daily limit (T-0069).
    // Their jids match the bundled AI chats so the AI panel finds them.
    ais: [
      seedAi('Dev AI', 'dev', 'ai-mock-dev'),
      {
        ...seedAi('Marketing AI', 'marketing', 'ai-mock-marketing'),
        model: 'claude-sonnet-5',
        jid: 'c-marketingai',
        providerConnectionId: 'conn-anthropic',
        usage: { todayUsd: 1.7, windowUsd: 6 },
      },
    ],
    connections: [
      {
        id: 'conn-openai',
        provider: 'openai',
        label: 'Work key',
        status: 'active',
        createdAt: '2026-09-20T10:00:00.000Z',
      },
      {
        id: 'conn-anthropic',
        provider: 'anthropic',
        label: 'Personal key',
        status: 'active',
        createdAt: '2026-09-21T10:00:00.000Z',
      },
    ],
    nextAiSequence: 1,
  };
}

let state = seedState();

/** Test seam: back to the seeded AIs, connections and profile. */
export function resetMockApi(): void {
  state = seedState();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function notImplemented(): Response {
  return jsonResponse(
    { error: { code: 'mock_not_implemented', message: 'This request has no mock handler' } },
    404,
  );
}

function notFound(message: string): Response {
  return jsonResponse({ error: { code: 'not_found', message } }, 404);
}

function readJsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string' || init.body === '') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(init.body);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readLimits(value: unknown): PublicAi['limits'] {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.perDayUsd === 'number' && typeof record.perMonthUsd === 'number') {
      return { perDayUsd: record.perDayUsd, perMonthUsd: record.perMonthUsd };
    }
  }
  return { perDayUsd: 2, perMonthUsd: 20 };
}

const TEMPLATES = ['dev', 'marketing', 'fun', 'custom'] as const;

function isTemplate(value: unknown): value is PublicAi['template'] {
  return typeof value === 'string' && (TEMPLATES as readonly string[]).includes(value);
}

function createAi(init: RequestInit): Response {
  const body = readJsonBody(init);
  const id = `ai-mock-${state.nextAiSequence}`;
  state.nextAiSequence += 1;
  const created: PublicAi = {
    id,
    name: typeof body.name === 'string' && body.name !== '' ? body.name : 'New AI',
    template: isTemplate(body.template) ? body.template : 'custom',
    persona: typeof body.persona === 'string' ? body.persona : '',
    model: typeof body.model === 'string' && body.model !== '' ? body.model : 'gpt-4o',
    jid: `ai-${id}@galena.test`,
    status: 'active',
    providerConnectionId:
      typeof body.providerConnectionId === 'string' ? body.providerConnectionId : 'conn-openai',
    limits: readLimits(body.limits),
    createdAt: new Date().toISOString(),
  };
  state.ais = [created, ...state.ais];
  return jsonResponse(created, 201);
}

function patchAi(ai: PublicAi, init: RequestInit): Response {
  const body = readJsonBody(init);
  const updated: PublicAi = { ...ai };
  if (typeof body.name === 'string') updated.name = body.name;
  if (typeof body.persona === 'string') updated.persona = body.persona;
  if (typeof body.model === 'string') updated.model = body.model;
  if (typeof body.providerConnectionId === 'string') {
    updated.providerConnectionId = body.providerConnectionId;
  }
  if (body.limits !== undefined) updated.limits = readLimits(body.limits);
  state.ais = state.ais.map((item) => (item.id === ai.id ? updated : item));
  return jsonResponse(updated);
}

function chatEntries(): ChatEntry[] {
  return mockChats.map((chat) => {
    if (chat.kind === 'group') {
      const detail = mockGroupDetails[chat.id];
      const membership = detail?.members.find((member) => member.userId === currentUserId);
      return {
        kind: 'group',
        chatJid: chat.id,
        title: chat.title,
        groupId: detail?.id ?? chat.id,
        memberCount: chat.memberCount ?? detail?.members.length ?? 0,
        role: membership?.role ?? 'member',
      };
    }
    return {
      kind: 'dm',
      chatJid: chat.id,
      title: chat.title,
      isAi: chat.isAI,
      ...(chat.avatarUrl === undefined ? {} : { avatarUrl: chat.avatarUrl }),
    };
  });
}

function contacts(): Contact[] {
  return Object.values(PEOPLE).map((person) => ({
    userId: person.id,
    name: person.name,
    jid: `${person.id}@galena.test`,
  }));
}

function normalizedPath(path: string): string {
  const raw = path.startsWith('/') ? path : `/${path}`;
  const withoutBase = raw.startsWith('/api/') ? raw.slice(4) : raw;
  const query = withoutBase.indexOf('?');
  return query === -1 ? withoutBase : withoutBase.slice(0, query);
}

function pathParts(path: string): string[] {
  return normalizedPath(path)
    .split('/')
    .filter((part) => part !== '');
}

/** Answers one API path; the shape of the body matches the real zod schemas. */
export async function mockRequest(
  path: string,
  init: RequestInit = {},
  options: MockRequestOptions = {},
): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? delayMs));
  const method = (init.method ?? 'GET').toUpperCase();
  const [head, first, second] = pathParts(path);

  if (head === 'me') {
    if (method === 'GET') return jsonResponse(state.me);
    if (method === 'PATCH') {
      const body = readJsonBody(init);
      if (typeof body.name === 'string') {
        state.me = { ...state.me, name: body.name };
      }
      return jsonResponse(state.me);
    }
    return notImplemented();
  }

  if (head === 'chats' && method === 'GET') {
    return jsonResponse({ chats: chatEntries() });
  }

  if (head === 'contacts' && method === 'GET') {
    return jsonResponse(contacts());
  }

  if (head === 'ais') {
    if (first === undefined) {
      if (method === 'GET') return jsonResponse(state.ais);
      if (method === 'POST') return createAi(init);
      return notImplemented();
    }
    const aiId = decodeURIComponent(first);
    const ai = state.ais.find((item) => item.id === aiId);
    if (ai === undefined) return notFound('That AI no longer exists.');
    if (method === 'GET') return jsonResponse(ai);
    if (method === 'PATCH') return patchAi(ai, init);
    if (method === 'DELETE') {
      state.ais = state.ais.filter((item) => item.id !== aiId);
      return noContent();
    }
    return notImplemented();
  }

  if (head === 'connections') {
    if (first === undefined) {
      if (method === 'GET') return jsonResponse(state.connections);
      return notImplemented();
    }
    const connectionId = decodeURIComponent(first);
    if (second === 'test' && method === 'POST') {
      return jsonResponse({ ok: true });
    }
    if (second === undefined && method === 'DELETE') {
      if (!state.connections.some((item) => item.id === connectionId)) {
        return notFound('No such connection.');
      }
      state.connections = state.connections.filter((item) => item.id !== connectionId);
      return noContent();
    }
    return notImplemented();
  }

  return notImplemented();
}

const API_PREFIX = '/api';

/** The API path of a fetch URL, or null when the URL is not under `/api`. */
function apiPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://localhost');
  } catch {
    return null;
  }
  if (parsed.pathname !== API_PREFIX && !parsed.pathname.startsWith(`${API_PREFIX}/`)) {
    return null;
  }
  return `${parsed.pathname.slice(API_PREFIX.length)}${parsed.search}`;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** A fetch that serves `/api` from `mockRequest` and passes everything else through. */
export function createMockFetch(
  realFetch: typeof globalThis.fetch,
  options: MockRequestOptions = {},
): typeof globalThis.fetch {
  return (input, init) => {
    const path = apiPath(urlOf(input));
    if (path === null) {
      return realFetch(input, init);
    }
    return mockRequest(path, init ?? {}, options);
  };
}

/**
 * Replaces `globalThis.fetch` with the mock wrapper. Needed for the connections
 * page, which mirrors `request()` with its own `fetch` (T-0028) and cannot be
 * edited by this task.
 */
export function installMockFetch(options: MockRequestOptions = {}): () => void {
  const realFetch = globalThis.fetch;
  const wrapped = createMockFetch(realFetch, options);
  globalThis.fetch = wrapped;
  return () => {
    globalThis.fetch = realFetch;
  };
}

// The app is server-less as soon as the mock layer loads. Unit tests fake
// `fetch` themselves, so `isMockApiEnabled` keeps this off there.
if (isMockApiEnabled() && typeof globalThis.fetch === 'function') {
  installMockFetch();
}
