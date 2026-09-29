import type { ChatEntry, Connection, Contact, Machine, Me, PublicAi } from '@/lib/api';
import { currentUserId, PEOPLE } from './ids';
import { mockChats } from './chats';
import { mockGroupDetails } from './groups';
import { approvalCard } from './helpers';

/**
 * The standalone mock HTTP layer (T-0069). In mock mode the app needs no
 * server: `request()` in lib/api.ts answers from here. Data lives in memory
 * for the page load only.
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
  nextConnectionSequence: number;
  machines: Machine[];
  // T-0076: one pending approval seeded from `approvalCard()` so the card
  // shows real Approve/Deny buttons in mock mode (matches the message in the
  // dev-team chat). It can be decided and then stays decided for the rest of
  // the page load.
  approvals: MockApproval[];
  audit: MockAuditEntry[];
}

interface MockAuditEntry {
  id: string;
  at: string;
  aiId: string;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: { currency: 'EUR' | 'USD'; amount: number } | null;
  result: 'ok' | 'denied' | 'error';
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
}

interface MockApproval {
  id: string;
  status: 'pending' | 'approved_once' | 'denied';
  decidedAt: string | null;
  note: string | null;
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
    // T-0070: one pending, one approved online, one revoked (11.5 sketch).
    machines: [
      {
        id: 'mach-pending',
        name: 'office-linux',
        status: 'pending',
        os: 'linux',
        osVersion: '6.6.0',
        arch: 'x86_64',
        cpu: 'AMD Ryzen 9 7950X',
        cores: 16,
        ramGb: 64,
        diskFreeGb: 920,
        drivers: ['docker', 'linux-vm'],
        fingerprint: 'a1b2c3d4e5f60718',
        createdAt: '2026-09-29T08:00:00.000Z',
        approvedAt: null,
        lastSeenAt: null,
      },
      {
        id: 'mach-approved',
        name: 'julio-mbp',
        status: 'approved',
        os: 'macos',
        osVersion: '27.0',
        arch: 'arm64',
        cpu: 'Apple M3 Pro',
        cores: 11,
        ramGb: 18,
        diskFreeGb: 200,
        drivers: ['docker', 'apple-container', 'macos-vm'],
        fingerprint: 'b2c3d4e5f607182a',
        createdAt: '2026-09-25T10:00:00.000Z',
        approvedAt: '2026-09-25T10:01:00.000Z',
        lastSeenAt: '2026-09-29T07:55:00.000Z',
        online: true,
      },
      {
        id: 'mach-revoked',
        name: 'old-macbook',
        status: 'revoked',
        os: 'macos',
        osVersion: '26.4',
        arch: 'arm64',
        cpu: 'Apple M2',
        cores: 8,
        ramGb: 16,
        diskFreeGb: 320,
        drivers: ['docker', 'macos-vm'],
        fingerprint: 'c3d4e5f607182a3b',
        createdAt: '2026-08-10T10:00:00.000Z',
        approvedAt: '2026-08-10T10:01:00.000Z',
        lastSeenAt: '2026-09-20T11:00:00.000Z',
      },
    ],
    nextAiSequence: 1,
    nextConnectionSequence: 1,
    // T-0076: one pending approval seeded from `approvalCard()`, so the chat
    // card has real Approve/Deny buttons out of the box. `id` matches the
    // approval card in mock/messages.ts.
    approvals: [
      {
        id: 'apr-42',
        status: 'pending',
        decidedAt: null,
        note: null,
      },
    ],
    audit: [
      {
        id: 'audit-dev-stopped',
        at: minutesAgo(7),
        aiId: 'ai-mock-dev',
        groupId: null,
        action: 'ai.stopped',
        subjectId: 'ai-mock-dev',
        argsHash: null,
        cost: null,
        result: 'ok',
        detail: null,
        actorUserId: currentUserId,
      },
      {
        id: 'audit-dev-resumed',
        at: minutesAgo(4),
        aiId: 'ai-mock-dev',
        groupId: null,
        action: 'ai.resumed',
        subjectId: 'ai-mock-dev',
        argsHash: null,
        cost: null,
        result: 'ok',
        detail: null,
        actorUserId: currentUserId,
      },
      {
        id: 'audit-dev-approval',
        at: minutesAgo(2),
        aiId: 'ai-mock-dev',
        groupId: null,
        action: 'approval.decided',
        subjectId: 'apr-42',
        argsHash: 'a'.repeat(64),
        cost: { currency: 'EUR', amount: 0.4 },
        result: 'ok',
        detail: { decision: 'approve_once' },
        actorUserId: currentUserId,
      },
      {
        id: 'audit-mkt-approval',
        at: minutesAgo(10),
        aiId: 'ai-mock-marketing',
        groupId: null,
        action: 'approval.decided',
        subjectId: 'apr-43',
        argsHash: 'b'.repeat(64),
        cost: { currency: 'USD', amount: 0.2 },
        result: 'denied',
        detail: { decision: 'deny' },
        actorUserId: currentUserId,
      },
      {
        id: 'audit-mkt-paired',
        at: minutesAgo(35),
        aiId: 'ai-mock-marketing',
        groupId: null,
        action: 'machine.paired',
        subjectId: 'mach-approved',
        argsHash: null,
        cost: null,
        result: 'ok',
        detail: null,
        actorUserId: currentUserId,
      },
    ],
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

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
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

// T-0080: the owner's stop and resume. The state in the mock layer mirrors
// the server's contract: `stopped` for an already-stopped AI is a no-op
// (returns the AI unchanged) and `disabled` is a 409 `not_active`. The mock
// has no `disabled` AIs today (createAi always lands on `active`), so the
// 409 branch is left here for symmetry with the real server's behaviour.
function stopOrResumeAi(ai: PublicAi, target: 'stopped' | 'active'): Response {
  if (ai.status === target) {
    return jsonResponse(ai);
  }
  if (ai.status === 'disabled') {
    return conflict('not_active', 'AI is not active');
  }
  const updated: PublicAi = { ...ai, status: target };
  state.ais = state.ais.map((item) => (item.id === ai.id ? updated : item));
  return jsonResponse(updated);
}

function createConnection(init: RequestInit): Response {
  const body = readJsonBody(init);
  const id = `conn-mock-${state.nextConnectionSequence}`;
  state.nextConnectionSequence += 1;
  const created: Connection = {
    id,
    provider: typeof body.provider === 'string' && body.provider !== '' ? body.provider : 'openai',
    label: typeof body.label === 'string' && body.label !== '' ? body.label : null,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  state.connections = [created, ...state.connections];
  return jsonResponse(created, 201);
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
    if (second === 'stop' && method === 'POST') {
      return stopOrResumeAi(ai, 'stopped');
    }
    if (second === 'resume' && method === 'POST') {
      return stopOrResumeAi(ai, 'active');
    }
    return notImplemented();
  }

  if (head === 'audit' && method === 'GET') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const aiId = params.get('aiId');
    if (aiId === null) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Provide exactly one of groupId or aiId' } },
        400,
      );
    }
    const limitParam = params.get('limit');
    const limit = limitParam === null ? 20 : Math.max(1, Math.min(50, Number(limitParam)));
    const entries = state.audit
      .filter((entry) => entry.aiId === aiId)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    return jsonResponse({ entries, next: null });
  }

  if (head === 'connections') {
    if (first === undefined) {
      if (method === 'GET') return jsonResponse(state.connections);
      if (method === 'POST') return createConnection(init);
      return notImplemented();
    }
    const connectionId = decodeURIComponent(first);
    if (second === 'test' && method === 'POST') {
      if (!state.connections.some((item) => item.id === connectionId)) {
        return notFound('No such connection.');
      }
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

  if (head === 'machines') {
    if (first === undefined) {
      if (method === 'GET') return jsonResponse(state.machines);
      return notImplemented();
    }
    if (first === 'pairing-codes' && second === undefined) {
      if (method === 'POST') return createPairingCodeResponse();
      return notImplemented();
    }
    const machineId = decodeURIComponent(first);
    const machine = state.machines.find((item) => item.id === machineId);
    if (machine === undefined) {
      return notFound('Machine not found');
    }
    if (second === 'approve' && method === 'POST') {
      if (machine.status !== 'pending') {
        return conflict('invalid_transition', 'Only pending machines can be approved');
      }
      const approved: Machine = {
        ...machine,
        status: 'approved',
        approvedAt: new Date().toISOString(),
      };
      state.machines = state.machines.map((item) => (item.id === machineId ? approved : item));
      return jsonResponse(approved);
    }
    if (second === 'deny' && method === 'POST') {
      if (machine.status !== 'pending') {
        return conflict('invalid_transition', 'Only pending machines can be denied');
      }
      state.machines = state.machines.filter((item) => item.id !== machineId);
      return noContent();
    }
    if (second === 'revoke' && method === 'POST') {
      if (machine.status === 'revoked') {
        return conflict('invalid_transition', 'Machine is already revoked');
      }
      const revoked: Machine = { ...machine, status: 'revoked' };
      state.machines = state.machines.map((item) => (item.id === machineId ? revoked : item));
      return jsonResponse(revoked);
    }
    if (second === undefined && method === 'PATCH') {
      const body = readJsonBody(init);
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return conflict('invalid_request', 'Name is required');
      }
      const renamed: Machine = { ...machine, name: body.name };
      state.machines = state.machines.map((item) => (item.id === machineId ? renamed : item));
      return jsonResponse(renamed);
    }
    if (second === undefined && method === 'DELETE') {
      if (machine.status === 'approved') {
        return conflict('revoke_first', 'Revoke the machine before deleting it');
      }
      state.machines = state.machines.filter((item) => item.id !== machineId);
      return noContent();
    }
    return notImplemented();
  }

  // T-0076: serve the approvals routes from `approvalCard()`. The card in the
  // dev-team chat carries `id: 'apr-42'`, so the seeded entry keeps the card
  // pending and decidable on first paint. Decisions flip it to the matching
  // terminal state; a second decision on the same id answers 409, exactly like
  // the server.
  if (head === 'approvals') {
    if (first === undefined && method === 'GET') {
      return jsonResponse(state.approvals.map(publicApproval).filter(isPendingApproval));
    }
    if (first === undefined) return notImplemented();
    const approvalId = decodeURIComponent(first);
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (approval === undefined) return notFound('Approval not found');
    if (second === undefined && method === 'GET') {
      return jsonResponse(publicApproval(approval));
    }
    if (second === 'decision' && method === 'POST') {
      if (approval.status !== 'pending') {
        return conflict('not_pending', 'Approval request has already been decided');
      }
      const body = readJsonBody(init);
      const decision = body.decision;
      if (decision !== 'approve_once' && decision !== 'approve_always' && decision !== 'deny') {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'Invalid decision body' } },
          400,
        );
      }
      const note = typeof body.note === 'string' ? body.note : null;
      approval.status = decision === 'deny' ? 'denied' : 'approved_once';
      approval.decidedAt = new Date().toISOString();
      approval.note = note;
      return jsonResponse(publicApproval(approval));
    }
    return notImplemented();
  }

  return notImplemented();
}

// T-0070: a fixed-format pairing code (4 chars, dash, 4 chars from an
// unambiguous alphabet) and an expiry 10 minutes in the future.
function createPairingCodeResponse(): Response {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = (): string => {
    let value = '';
    for (let i = 0; i < 4; i += 1) {
      value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
  };
  const code = `${block()}-${block()}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return jsonResponse({ code, expiresAt }, 201);
}

function conflict(code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, 409);
}

// T-0076: read-model helpers for the seeded approval. `approvalCard()` is the
// source of truth for the request payload (action, summary, hash, costs,
// expiry); the local row only carries the decision.
function publicApproval(row: MockApproval): {
  id: string;
  aiId: string;
  groupId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: 'pending' | 'approved_once' | 'denied';
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
} {
  const card = approvalCard();
  if (card.type !== 'approval.request') {
    throw new Error('approvalCard() must be an approval.request payload');
  }
  const data = card.data;
  return {
    id: row.id,
    aiId: data.ai,
    groupId: data.room,
    action: data.action,
    summary: data.summary,
    details: data.details ?? null,
    argsHash: data.args_hash,
    worstCase: data.worst_case_cost ?? null,
    requestedBy: data.requested_by,
    status: row.status,
    decidedAt: row.decidedAt,
    note: row.note,
    expiresAt: data.expires_at,
    createdAt: new Date().toISOString(),
  };
}

function isPendingApproval(approval: { status: string; expiresAt: string }): boolean {
  return approval.status === 'pending' && new Date(approval.expiresAt).getTime() > Date.now();
}
