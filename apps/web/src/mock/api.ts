import type { ChatEntry, Connection, Contact, Machine, Me, PublicAi } from '@/lib/api';
import { currentUserId, PEOPLE } from './ids';
import { mockChats } from './chats';
import { mockGroupDetails } from './groups';
import { mockMessages } from './messages';
import { approvalCard } from './helpers';
import { mockTopicAisById, mockTopicChats, mockTopicMembersById } from './topics';

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
  // T-0100: standing approval rules created by `approve_always` decisions.
  // Listed by the AI panel (`?aiId`) and the group panel (`?groupId`).
  approvalRules: MockApprovalRule[];
  audit: MockAuditEntry[];
  // T-0111: the Dev team topics. Created topics append here; patches edit
  // in place; archived ids hide from the list (the row survives).
  topics: MockTopic[];
  nextTopicSequence: number;
  // T-0115: group invite links in memory for the page load. `inviteTokens`
  // maps each shown-once token to its link id; the `links` rows carry hints
  // only, like the real server's list.
  inviteLinks: MockInviteLink[];
  inviteTokens: Map<string, string>;
  nextInviteLinkSequence: number;
  // T-0113: per-chat prefs (mute/archive/pin) in memory for the page load.
  chatPrefs: MockChatPref[];
  // T-0114: pinned messages in memory for the page load, keyed by the chat
  // id the client names the chat with (the mock has no JID access model).
  pins: MockPin[];
  nextPinSequence: number;
}

type TopicVisibility = 'public' | 'private';
type TopicKind = 'chat' | 'task' | 'bug' | 'ui' | 'routine';
type TopicStatus = 'open' | 'in_progress' | 'in_review' | 'blocked' | 'done';

interface MockTopicOwner {
  kind: 'user' | 'ai';
  id: string;
  name: string;
}

interface MockTopic {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: MockTopicOwner | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  memberIds: string[];
  aiIds: string[];
}

// T-0115: one group invite link row, mirroring the server's list view
// (hints, never tokens).
interface MockInviteLink {
  id: string;
  groupId: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

// T-0113: one chat-preference row, mirroring the server's `chat_prefs`.
interface MockChatPref {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

// T-0114: one pinned message row, mirroring the server's `pinned_messages`
// (the mock keys by the client chat id instead of the canonical pair key).
interface MockPin {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: 'text' | 'image' | 'file' | 'voice' | 'card';
  pinnedBy: string;
  pinnedAt: string;
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
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied';
  decidedAt: string | null;
  note: string | null;
}

// T-0100: one standing rule row. `groupId` null means the personal chat
// with the AI's owner, exactly like the server's `approval_rules`.
interface MockApprovalRule {
  id: string;
  aiId: string;
  action: string;
  scope: 'personal' | 'group';
  groupId: string | null;
  createdAt: string;
  createdBy: string;
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
    machineId: 'mach-approved',
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

const MOCK_PEOPLE_NAMES: Record<string, string> = {
  'u-you': 'You',
  'u-ana': 'Ana',
  'u-luis': 'Luis',
  'u-marco': 'Marco',
  'u-marta': 'Marta',
  'u-sofia': 'Sofía',
};

const MOCK_AI_NAMES: Record<string, string> = {
  'dev-1': 'Dev-1',
  'qa-1': 'QA-1',
  marketing: 'Marketing AI',
  'research-1': 'Researcher',
};

function mockPersonName(userId: string): string {
  return MOCK_PEOPLE_NAMES[userId] ?? 'Someone';
}

function mockAiName(aiId: string): string {
  return MOCK_AI_NAMES[aiId] ?? 'An AI';
}

// T-0111: the Dev team topics from the mock bundle, as API rows. General
// keeps the group's old chat id; every other topic gets its own chat id.
// Private hiring starts with Ana + you; the bug topic starts with Dev-1.
function seedTopics(): MockTopic[] {
  const chats = mockTopicChats();
  const members = mockTopicMembersById();
  const ais = mockTopicAisById();
  return chats.map((chat) => {
    const info = chat.topic;
    if (info === undefined) {
      throw new Error('mockTopicChats must carry a topic');
    }
    return {
      id: info.id,
      groupId: 'g-devteam',
      name: chat.title,
      glyph: info.glyph,
      chatJid: chat.id,
      visibility: info.visibility,
      kind: info.kind,
      status: info.status,
      owner: info.owner,
      linkUrl: info.linkUrl,
      linkLabel: info.linkLabel,
      isGeneral: info.isGeneral,
      archived: false,
      memberIds:
        info.visibility === 'private'
          ? (members[info.id] ?? []).map((member) => member.userId)
          : [],
      aiIds: (ais[info.id] ?? []).map((ai) => ai.id),
    };
  });
}

function topicToView(topic: MockTopic): Record<string, unknown> {
  return {
    id: topic.id,
    groupId: topic.groupId,
    name: topic.name,
    glyph: topic.glyph,
    chatJid: topic.chatJid,
    visibility: topic.visibility,
    kind: topic.kind,
    status: topic.status,
    owner: topic.owner,
    linkUrl: topic.linkUrl,
    linkLabel: topic.linkLabel,
    isGeneral: topic.isGeneral,
    archived: topic.archived,
    memberCount:
      topic.visibility === 'private'
        ? topic.memberIds.length
        : (mockGroupDetails['c-devteam']?.members.length ?? topic.memberIds.length),
    ais: topic.aiIds.map((aiId) => ({ id: aiId, name: mockAiName(aiId) })),
  };
}

function findTopic(id: string): MockTopic | undefined {
  return state.topics.find((topic) => topic.id === id);
}

function glyphForTopic(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

// T-0114: two seeded pins so the banner and the panel show in mock mode
// (one text pin in the Ana DM, one photo pin in the Viernes group).
function seedPins(): MockPin[] {
  return [
    {
      id: 'pin-1',
      chat: 'c-ana',
      messageId: 'ana-17',
      senderName: 'You',
      text: 'Deal',
      kind: 'text',
      pinnedBy: currentUserId,
      pinnedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    },
    {
      id: 'pin-2',
      chat: 'c-viernes',
      messageId: 'vie-7',
      senderName: 'Marta',
      text: '',
      kind: 'image',
      pinnedBy: currentUserId,
      pinnedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
  ];
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
    approvalRules: [],
    topics: seedTopics(),
    nextTopicSequence: 1,
    inviteLinks: [],
    inviteTokens: new Map(),
    nextInviteLinkSequence: 1,
    chatPrefs: [],
    pins: seedPins(),
    nextPinSequence: 3,
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
      // T-0086: group-scoped entries, served when the panel asks for
      // `?groupId=g-devteam`. They share the action vocabulary with the AI
      // log so the panel renders them in the same words.
      {
        id: 'audit-devteam-approval',
        at: minutesAgo(15),
        aiId: 'dev-1',
        groupId: 'g-devteam',
        action: 'approval.decided',
        subjectId: 'apr-100',
        argsHash: 'c'.repeat(64),
        cost: { currency: 'EUR', amount: 0.25 },
        result: 'ok',
        detail: { decision: 'approve_once' },
        actorUserId: currentUserId,
      },
      {
        id: 'audit-devteam-deny',
        at: minutesAgo(28),
        aiId: 'qa-1',
        groupId: 'g-devteam',
        action: 'approval.decided',
        subjectId: 'apr-101',
        argsHash: 'd'.repeat(64),
        cost: { currency: 'USD', amount: 0.1 },
        result: 'denied',
        detail: { decision: 'deny' },
        actorUserId: currentUserId,
      },
      {
        id: 'audit-qa-approval',
        at: minutesAgo(40),
        aiId: 'qa-1',
        groupId: 'g-qa',
        action: 'approval.decided',
        subjectId: 'apr-102',
        argsHash: 'e'.repeat(64),
        cost: { currency: 'EUR', amount: 0.5 },
        result: 'ok',
        detail: { decision: 'approve_always' },
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
    machineId: null,
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

function assignMachine(ai: PublicAi, init: RequestInit): Response {
  const body = readJsonBody(init);
  if (!('machineId' in body)) {
    return jsonResponse(
      { error: { code: 'invalid_request', message: 'machineId is required' } },
      400,
    );
  }
  const machineId = body.machineId;
  if (machineId !== null && typeof machineId !== 'string') {
    return jsonResponse(
      { error: { code: 'invalid_request', message: 'machineId must be a string or null' } },
      400,
    );
  }
  if (machineId !== null) {
    const machine = state.machines.find((item) => item.id === machineId);
    if (machine === undefined || machine.status !== 'approved') {
      return notFound('Machine not found');
    }
  }
  const updated: PublicAi = { ...ai, machineId: machineId };
  state.ais = state.ais.map((item) => (item.id === ai.id ? updated : item));
  // T-0091: revoke also clears the AI link, matching the real server.
  for (const item of state.ais) {
    if (
      item.machineId !== null &&
      !state.machines.some((m) => m.id === item.machineId && m.status === 'approved')
    ) {
      item.machineId = null;
    }
  }
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
      const entry = {
        kind: 'group',
        chatJid: chat.id,
        title: chat.title,
        groupId: detail?.id ?? chat.id,
        memberCount: chat.memberCount ?? detail?.members.length ?? 0,
        role: membership?.role ?? 'member',
      } as ChatEntry & { topics?: unknown[] };
      // T-0111: the Dev team group carries its visible topics (archived
      // excluded). The mock has one user, who sees every topic.
      if (detail?.id === 'g-devteam') {
        entry.topics = state.topics
          .filter((topic) => !topic.archived)
          .map((topic) => topicToView(topic));
      }
      return entry;
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

function patchMockTopic(topic: MockTopic, init: RequestInit): Response {
  const body = readJsonBody(init);
  if (typeof body.name === 'string' && body.name.trim() !== '') {
    topic.name = body.name.trim().slice(0, 80);
  }
  if (typeof body.glyph === 'string' && body.glyph !== '') {
    topic.glyph = body.glyph;
  }
  if (
    body.kind === 'chat' ||
    body.kind === 'task' ||
    body.kind === 'bug' ||
    body.kind === 'ui' ||
    body.kind === 'routine'
  ) {
    topic.kind = body.kind;
  }
  if (
    body.status === 'open' ||
    body.status === 'in_progress' ||
    body.status === 'in_review' ||
    body.status === 'blocked' ||
    body.status === 'done'
  ) {
    topic.status = body.status;
  }
  if (body.owner === null) {
    topic.owner = null;
  } else if (
    body.owner !== undefined &&
    typeof body.owner === 'object' &&
    body.owner !== null &&
    (body.owner as Record<string, unknown>).kind !== undefined
  ) {
    const owner = body.owner as Record<string, unknown>;
    if (owner.kind === 'user' && typeof owner.id === 'string') {
      topic.owner = { kind: 'user', id: owner.id, name: mockPersonName(owner.id) };
    } else if (owner.kind === 'ai' && typeof owner.id === 'string') {
      topic.owner = { kind: 'ai', id: owner.id, name: mockAiName(owner.id) };
    }
  }
  if (body.linkUrl === null || body.linkUrl === undefined) {
    if ('linkUrl' in body) {
      topic.linkUrl = null;
    }
  } else if (typeof body.linkUrl === 'string') {
    topic.linkUrl = body.linkUrl;
  }
  if (body.linkLabel === null || body.linkLabel === undefined) {
    if ('linkLabel' in body) {
      topic.linkLabel = null;
    }
  } else if (typeof body.linkLabel === 'string') {
    topic.linkLabel = body.linkLabel.slice(0, 40);
  }
  if (body.archived === true) {
    if (topic.isGeneral) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'General cannot be archived' } },
        400,
      );
    }
    topic.archived = true;
  }
  if (body.visibility === 'public' || body.visibility === 'private') {
    if (body.visibility === 'public' && topic.visibility === 'private') {
      if (body.confirmExposeHistory !== true) {
        return jsonResponse(
          { error: { code: 'confirmation_required', message: 'Confirm exposing the history' } },
          400,
        );
      }
      topic.visibility = 'public';
      topic.memberIds = [];
    } else if (body.visibility === 'private' && topic.visibility === 'public') {
      const memberIds = Array.isArray(body.memberIds)
        ? body.memberIds.filter((item): item is string => typeof item === 'string')
        : [];
      topic.visibility = 'private';
      topic.memberIds = [...new Set([currentUserId, ...memberIds])];
    }
  }
  return jsonResponse(topicToView(topic));
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

  // T-0113: in-memory chat prefs. The mock has no access model, so any JID
  // can carry a row; a write back at all defaults deletes the row.
  if (head === 'chat-prefs' && first === undefined && method === 'GET') {
    return jsonResponse({ prefs: state.chatPrefs });
  }

  if (head === 'chat-prefs' && first !== undefined && second === undefined && method === 'PUT') {
    const chatJid = decodeURIComponent(first);
    const body = readJsonBody(init);
    const allowed = new Set(['mutedUntil', 'archived', 'pinned']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: `Unknown field: ${key}` } },
          400,
        );
      }
    }
    if (Object.keys(body).length === 0) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Nothing to update' } },
        400,
      );
    }
    if (
      ('mutedUntil' in body && body.mutedUntil !== null && typeof body.mutedUntil !== 'string') ||
      ('archived' in body && typeof body.archived !== 'boolean') ||
      ('pinned' in body && typeof body.pinned !== 'boolean')
    ) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Invalid preference body' } },
        400,
      );
    }
    const key = chatJid.toLowerCase();
    const existing = state.chatPrefs.find((pref) => pref.chatJid.toLowerCase() === key);
    const mutedUntil = !('mutedUntil' in body)
      ? (existing?.mutedUntil ?? null)
      : (body.mutedUntil as string | null);
    if (mutedUntil !== null && Number.isNaN(Date.parse(mutedUntil))) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'mutedUntil must be a valid date' } },
        400,
      );
    }
    const archived = !('archived' in body)
      ? (existing?.archived ?? false)
      : (body.archived as boolean);
    const pinnedAt = !('pinned' in body)
      ? (existing?.pinnedAt ?? null)
      : (body.pinned as boolean)
        ? (existing?.pinnedAt ?? new Date().toISOString())
        : null;
    if (mutedUntil === null && archived === false && pinnedAt === null) {
      state.chatPrefs = state.chatPrefs.filter((pref) => pref.chatJid.toLowerCase() !== key);
      return jsonResponse({ prefs: null });
    }
    const row: MockChatPref = {
      chatJid,
      mutedUntil,
      archived,
      pinnedAt,
      updatedAt: new Date().toISOString(),
    };
    state.chatPrefs =
      existing === undefined
        ? [...state.chatPrefs, row]
        : state.chatPrefs.map((pref) => (pref.chatJid.toLowerCase() === key ? row : pref));
    // Pin cap of 20, mirroring the server.
    if (state.chatPrefs.filter((pref) => pref.pinnedAt !== null).length > 20) {
      state.chatPrefs = state.chatPrefs.filter((pref) => pref.chatJid.toLowerCase() !== key);
      if (existing !== undefined) {
        state.chatPrefs = [...state.chatPrefs, existing];
      }
      return jsonResponse(
        { error: { code: 'too_many_pins', message: 'Too many pinned chats' } },
        409,
      );
    }
    return jsonResponse(row);
  }

  // T-0114: in-memory pins. The mock has one user who may pin anywhere;
  // permission gating lives in the store and the menu, like the real
  // server's manager check. Newest first, at most 20 per chat.
  if (head === 'pins' && first === undefined) {
    if (method === 'GET') {
      const params = new URLSearchParams(
        path.includes('?') ? path.slice(path.indexOf('?') + 1) : '',
      );
      const chat = params.get('chat') ?? '';
      const pins = state.pins
        .filter((pin) => pin.chat === chat)
        .sort((a, b) => (a.pinnedAt < b.pinnedAt ? 1 : a.pinnedAt > b.pinnedAt ? -1 : 0));
      return jsonResponse({ pins });
    }
    if (method === 'POST') {
      const body = readJsonBody(init);
      const chat = typeof body.chat === 'string' ? body.chat : '';
      const messageId = typeof body.messageId === 'string' ? body.messageId : '';
      const senderName =
        typeof body.senderName === 'string' ? body.senderName.trim().slice(0, 80) : '';
      const text = typeof body.text === 'string' ? body.text.slice(0, 300) : '';
      const kind =
        body.kind === 'image' ||
        body.kind === 'file' ||
        body.kind === 'voice' ||
        body.kind === 'card'
          ? body.kind
          : 'text';
      if (chat === '' || messageId === '' || senderName === '') {
        return jsonResponse(
          {
            error: {
              code: 'invalid_request',
              message: 'chat, messageId and senderName are required',
            },
          },
          400,
        );
      }
      if (state.pins.some((pin) => pin.chat === chat && pin.messageId === messageId)) {
        return conflict('pin_exists', 'That message is already pinned');
      }
      if (state.pins.filter((pin) => pin.chat === chat).length >= 20) {
        return jsonResponse({ error: { code: 'pin_limit', message: 'Too many pins' } }, 400);
      }
      const created: MockPin = {
        id: `pin-mock-${state.nextPinSequence}`,
        chat,
        messageId,
        senderName,
        text: kind === 'text' ? text : '',
        kind,
        pinnedBy: currentUserId,
        pinnedAt: new Date().toISOString(),
      };
      state.nextPinSequence += 1;
      state.pins = [...state.pins, created];
      return jsonResponse(created, 201);
    }
    return notImplemented();
  }

  if (head === 'pins' && first !== undefined && second === undefined && method === 'DELETE') {
    const pinId = decodeURIComponent(first);
    const pin = state.pins.find((item) => item.id === pinId);
    if (pin === undefined) {
      return notFound('Pin not found');
    }
    state.pins = state.pins.filter((item) => item.id !== pinId);
    return jsonResponse(pin);
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
    // T-0100: the AI's standing rules. The mock has one user, the AI
    // owner, so any found AI is manageable — like the real server's
    // owner-only route with the mock's single user.
    if (second === 'approval-rules' && method === 'GET') {
      return jsonResponse(state.approvalRules.filter((rule) => rule.aiId === ai.id));
    }
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
    if (second === 'machine' && method === 'PUT') {
      return assignMachine(ai, init);
    }
    return notImplemented();
  }

  if (head === 'search' && method === 'GET') {
    return searchMessages(path);
  }

  // T-0115: invite links in memory for the page load. The mock is the
  // group owner everywhere it matters, so create/list/revoke always succeed
  // for known groups. Tokens are random hex shown once at creation; the list
  // carries hints, never tokens — like the real server. `pathParts` drops
  // the link id, so the revoke branch matches on raw segments.
  if (head === 'groups' && second === 'invite-links') {
    const segments =
      path
        .split('?')[0]
        ?.split('/')
        .filter((part) => part !== '') ?? [];
    const groupId = decodeURIComponent(first ?? '');
    const known = Object.values(mockGroupDetails).some((item) => item.id === groupId);
    if (!known) {
      return notFound('Group not found');
    }
    // `/groups/:id/invite-links/:linkId` — revoke, idempotent.
    if (segments.length === 4 && method === 'DELETE') {
      const linkId = decodeURIComponent(segments[3] ?? '');
      const link = state.inviteLinks.find((item) => item.id === linkId && item.groupId === groupId);
      if (link !== undefined) {
        link.revoked = true;
      }
      return noContent();
    }
    if (segments.length !== 3) {
      return notImplemented();
    }
    if (method === 'GET') {
      return jsonResponse({ links: state.inviteLinks.filter((link) => link.groupId === groupId) });
    }
    if (method === 'POST') {
      const body = readJsonBody(init);
      const active = state.inviteLinks.filter((link) => link.groupId === groupId && !link.revoked);
      if (active.length >= 10) {
        return jsonResponse(
          { error: { code: 'too_many_links', message: 'This group already has 10 links' } },
          409,
        );
      }
      const label =
        typeof body.label === 'string' && body.label.trim() !== ''
          ? body.label.trim().slice(0, 60)
          : null;
      const maxUses =
        typeof body.maxUses === 'number' && Number.isInteger(body.maxUses) && body.maxUses >= 1
          ? body.maxUses
          : null;
      const expiresAt =
        typeof body.expiresInHours === 'number' &&
        Number.isInteger(body.expiresInHours) &&
        body.expiresInHours >= 1
          ? new Date(Date.now() + body.expiresInHours * 3_600_000).toISOString()
          : null;
      const token = Array.from({ length: 64 }, () =>
        '0123456789abcdef'.charAt(Math.floor(Math.random() * 16)),
      ).join('');
      const id = `link-mock-${state.nextInviteLinkSequence}`;
      state.nextInviteLinkSequence += 1;
      const created: MockInviteLink = {
        id,
        groupId,
        label,
        tokenHint: token.slice(-4),
        uses: 0,
        maxUses,
        expiresAt,
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      state.inviteTokens.set(token, id);
      state.inviteLinks = [...state.inviteLinks, created];
      return jsonResponse({ id, token, url: `http://localhost:5173/j/${token}` }, 201);
    }
    return notImplemented();
  }

  // T-0115: join by link. The mock's single user is already in the Dev team
  // group (so it previews as a member); unknown tokens 404 `invalid_link`.
  if (head === 'join' && first !== undefined && second === undefined) {
    const token = decodeURIComponent(first);
    const linkId = state.inviteTokens.get(token);
    const link =
      linkId === undefined ? undefined : state.inviteLinks.find((item) => item.id === linkId);
    if (link === undefined || link.revoked) {
      return jsonResponse(
        { error: { code: 'invalid_link', message: 'This invite link is invalid' } },
        404,
      );
    }
    if (
      (link.expiresAt !== null && Date.parse(link.expiresAt) <= Date.now()) ||
      (link.maxUses !== null && link.uses >= link.maxUses)
    ) {
      return jsonResponse(
        { error: { code: 'invalid_link', message: 'This invite link is invalid' } },
        404,
      );
    }
    const detail = Object.values(mockGroupDetails).find((item) => item.id === link.groupId);
    if (detail === undefined) {
      return jsonResponse(
        { error: { code: 'invalid_link', message: 'This invite link is invalid' } },
        404,
      );
    }
    const alreadyMember = detail.members.some((member) => member.userId === currentUserId);
    if (method === 'GET') {
      return jsonResponse({
        groupTitle: detail.title,
        memberCount: detail.members.length,
        alreadyMember,
      });
    }
    if (method === 'POST') {
      if (!alreadyMember) {
        link.uses += 1;
      }
      return jsonResponse({ groupId: link.groupId, alreadyMember });
    }
    return notImplemented();
  }

  // T-0111: the group's topic settings switch. The mock has one user,
  // the group owner, so PATCH always succeeds for the Dev team group.
  if (head === 'groups' && second === undefined && method === 'PATCH') {
    const groupId = decodeURIComponent(first ?? '');
    const detail = Object.values(mockGroupDetails).find((item) => item.id === groupId);
    if (detail === undefined) {
      return notFound('Group not found');
    }
    const body = readJsonBody(init);
    if (typeof body.membersCanCreateTopics === 'boolean') {
      const updated = { ...detail, membersCanCreateTopics: body.membersCanCreateTopics };
      for (const [chatId, entry] of Object.entries(mockGroupDetails)) {
        if (entry.id === groupId) {
          mockGroupDetails[chatId] = updated;
        }
      }
      return jsonResponse(updated);
    }
    return jsonResponse(detail);
  }

  // T-0111: topics of a group (visible to the mock's single user).
  if (head === 'groups' && second === 'topics') {
    const groupId = decodeURIComponent(first ?? '');
    if (groupId !== 'g-devteam') {
      return notFound('Group not found');
    }
    if (method === 'GET') {
      return jsonResponse({
        topics: state.topics.filter((topic) => !topic.archived).map((topic) => topicToView(topic)),
      });
    }
    if (method === 'POST') {
      const body = readJsonBody(init);
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (name === '') {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'name is required' } },
          400,
        );
      }
      const visibility = body.visibility === 'private' ? 'private' : 'public';
      const kind =
        body.kind === 'task' || body.kind === 'bug' || body.kind === 'ui' || body.kind === 'routine'
          ? body.kind
          : 'chat';
      const id = `t-mock-${state.nextTopicSequence}`;
      state.nextTopicSequence += 1;
      const created: MockTopic = {
        id,
        groupId: 'g-devteam',
        name,
        glyph:
          typeof body.glyph === 'string' && body.glyph !== '' ? body.glyph : glyphForTopic(name),
        chatJid: `${id}@rooms.galena.test`,
        visibility,
        kind,
        status: 'open',
        owner: null,
        linkUrl: null,
        linkLabel: null,
        isGeneral: false,
        archived: false,
        memberIds:
          visibility === 'private'
            ? [
                ...new Set([
                  currentUserId,
                  ...(Array.isArray(body.memberIds)
                    ? body.memberIds.filter((item): item is string => typeof item === 'string')
                    : []),
                ]),
              ]
            : [],
        aiIds: [],
      };
      state.topics = [...state.topics, created];
      return jsonResponse(topicToView(created), 201);
    }
    return notImplemented();
  }

  if (head === 'topics' && first !== undefined) {
    const topicId = decodeURIComponent(first);
    // `/topics/:id/members/:userId` and `/topics/:id/ais/:aiId` carry a
    // fourth segment; `second` is the sub-resource, `third` its id.
    const segments = pathParts(path);
    const subId = segments[3];
    const topic = findTopic(topicId);
    if (topic === undefined || topic.archived) {
      return notFound('Topic not found');
    }
    if (second === undefined) {
      if (method === 'GET') {
        return jsonResponse(topicToView(topic));
      }
      if (method === 'PATCH') {
        return patchMockTopic(topic, init);
      }
      return notImplemented();
    }
    if (second === 'archive' && method === 'POST') {
      if (topic.isGeneral) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'General cannot be archived' } },
          400,
        );
      }
      topic.archived = true;
      return jsonResponse(topicToView(topic));
    }
    if (second === 'members' && subId === undefined) {
      if (method === 'GET') {
        if (topic.visibility !== 'private') {
          return jsonResponse({
            members: (mockGroupDetails['c-devteam']?.members ?? []).map((member) => ({
              userId: member.userId,
              name: member.name,
            })),
          });
        }
        return jsonResponse({
          members: topic.memberIds.map((userId) => ({ userId, name: mockPersonName(userId) })),
        });
      }
      if (method === 'POST') {
        const body = readJsonBody(init);
        const userId = typeof body.userId === 'string' ? body.userId : '';
        if (userId !== '' && !topic.memberIds.includes(userId)) {
          topic.memberIds = [...topic.memberIds, userId];
        }
        return jsonResponse(topicToView(topic));
      }
      return notImplemented();
    }
    if (second === 'members' && subId !== undefined && method === 'DELETE') {
      const userId = decodeURIComponent(subId);
      // Like the server: removing a user who is not a member answers 404
      // (`service.ts` "not a member"), so clients cannot read a 404 as
      // "the topic is gone" without re-checking the row.
      if (!topic.memberIds.includes(userId)) {
        return notFound('That user is not a member of this topic');
      }
      topic.memberIds = topic.memberIds.filter((id) => id !== userId);
      if (topic.memberIds.length === 0 && topic.visibility === 'private') {
        topic.archived = true;
        return notFound('Topic not found');
      }
      return jsonResponse(topicToView(topic));
    }
    if (second === 'ais' && subId === undefined) {
      if (method === 'GET') {
        return jsonResponse({
          ais: topic.aiIds.map((aiId) => ({ id: aiId, name: mockAiName(aiId) })),
        });
      }
      if (method === 'POST') {
        const body = readJsonBody(init);
        const aiId = typeof body.aiId === 'string' ? body.aiId : '';
        if (aiId === '' || mockAiName(aiId) === 'An AI') {
          return jsonResponse({ error: { code: 'invalid_request', message: 'Unknown AI' } }, 400);
        }
        if (!topic.aiIds.includes(aiId)) {
          topic.aiIds = [...topic.aiIds, aiId];
        }
        return jsonResponse(topicToView(topic));
      }
      return notImplemented();
    }
    if (second === 'ais' && subId !== undefined && method === 'DELETE') {
      const aiId = decodeURIComponent(subId);
      topic.aiIds = topic.aiIds.filter((id) => id !== aiId);
      return jsonResponse(topicToView(topic));
    }
    if (second === 'tools' && method === 'GET') {
      return jsonResponse([]);
    }
    return notImplemented();
  }

  if (head === 'audit' && method === 'GET') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const aiId = params.get('aiId');
    const groupId = params.get('groupId');
    if ((aiId === null) === (groupId === null)) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Provide exactly one of groupId or aiId' } },
        400,
      );
    }
    const limitParam = params.get('limit');
    const limit = limitParam === null ? 20 : Math.max(1, Math.min(50, Number(limitParam)));
    const matches =
      aiId !== null
        ? (entry: MockAuditEntry): boolean => entry.aiId === aiId
        : (entry: MockAuditEntry): boolean => entry.groupId === groupId;
    const entries = state.audit
      .filter(matches)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    return jsonResponse({ entries, next: null });
  }

  // T-0100: the group's standing rules. Managers only, like the real
  // server — but the mock store knows the members from `mockGroupDetails`
  // while this API layer answers by group id, so the lookup walks the
  // details for a matching group id.
  if (head === 'groups' && second === 'approval-rules' && method === 'GET') {
    const groupId = decodeURIComponent(first ?? '');
    const detail = Object.values(mockGroupDetails).find((item) => item.id === groupId);
    if (detail === undefined) {
      return notFound('Group not found');
    }
    const viewer = detail.members.find((member) => member.userId === currentUserId);
    if (viewer === undefined || (viewer.role !== 'owner' && viewer.role !== 'admin')) {
      return notFound('Group not found');
    }
    return jsonResponse(state.approvalRules.filter((rule) => rule.groupId === groupId));
  }

  if (head === 'approval-rules' && first !== undefined && second === undefined) {
    const ruleId = decodeURIComponent(first);
    if (method === 'DELETE') {
      // Idempotent, like the real server: removing a missing id is silent
      // (the client's 404 branch covers a row that is not manageable).
      state.approvalRules = state.approvalRules.filter((rule) => rule.id !== ruleId);
      return noContent();
    }
    return notImplemented();
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
      // T-0091: revoke also clears the AI link, matching the real server.
      state.ais = state.ais.map((ai) =>
        ai.machineId === machineId ? { ...ai, machineId: null } : ai,
      );
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
      // T-0100: `approve_always` stands the decision (and creates the rule
      // the AI panel lists); every mock action is always-eligible.
      if (decision === 'approve_always') {
        approval.status = 'approved_always';
        approval.decidedAt = new Date().toISOString();
        approval.note = note;
        const built = publicApproval(approval);
        const existing = state.approvalRules.find(
          (rule) =>
            rule.aiId === built.aiId &&
            rule.groupId === built.groupId &&
            rule.action === built.action,
        );
        if (existing === undefined) {
          state.approvalRules = [
            ...state.approvalRules,
            {
              id: `rule-${approval.id}-${built.action}`,
              aiId: built.aiId,
              action: built.action,
              scope: built.groupId === null ? 'personal' : 'group',
              groupId: built.groupId,
              createdAt: new Date().toISOString(),
              createdBy: currentUserId,
            },
          ];
        }
        return jsonResponse(publicApproval(approval));
      }
      approval.status = decision === 'deny' ? 'denied' : 'approved_once';
      approval.decidedAt = new Date().toISOString();
      approval.note = note;
      return jsonResponse(publicApproval(approval));
    }
    return notImplemented();
  }

  return notImplemented();
}

// T-0117: a small in-memory index over the mock messages. Case-insensitive
// substring match over text bodies (deleted messages and cards have no
// searchable text); newest first; `chat` narrows to one mock chat id.
function searchMessages(path: string): Response {
  const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
  const q = (params.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 100) {
    return jsonResponse(
      { error: { code: 'invalid_request', message: 'Invalid search query' } },
      400,
    );
  }
  const chat = params.get('chat');
  const limitParam = params.get('limit');
  const limit = limitParam === null ? 20 : Math.max(1, Math.min(50, Number(limitParam)));
  const before = params.get('before');
  const beforeTime = before === null ? null : Date.parse(before);
  const needle = q.toLowerCase();

  const items: Array<{
    chatJid: string;
    messageId: string;
    senderName: string;
    at: string;
    snippet: string;
    marks: Array<[number, number]>;
  }> = [];
  for (const [chatId, messages] of Object.entries(mockMessages)) {
    if (chat !== null && chat !== chatId) {
      continue;
    }
    for (const message of messages) {
      if (message.text === undefined || message.deleted === true) {
        continue;
      }
      const index = message.text.toLowerCase().indexOf(needle);
      if (index < 0) {
        continue;
      }
      const at = message.createdAt;
      if (beforeTime !== null && !Number.isNaN(beforeTime) && at.getTime() >= beforeTime) {
        continue;
      }
      const begin = codePointIndex(message.text, index);
      items.push({
        chatJid: chatId,
        messageId: message.id,
        senderName: message.senderName,
        at: at.toISOString(),
        snippet: message.text,
        marks: [[begin, begin + [...needle].length]],
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = items.slice(0, limit);
  const last = page.at(-1);
  return jsonResponse({
    items: page,
    ...(last === undefined || items.length <= limit ? {} : { nextBefore: last.at }),
  });
}

// `String.indexOf` counts UTF-16 units; marks count characters like the server.
function codePointIndex(text: string, utf16Index: number): number {
  let count = 0;
  for (const _ of text.slice(0, utf16Index)) {
    count += 1;
  }
  return count;
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
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied';
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  // T-0100: the seeded card is always-eligible in the personal chat.
  alwaysEligible: boolean;
} {
  const card = approvalCard();
  if (card.type !== 'approval.request') {
    throw new Error('approvalCard() must be an approval.request payload');
  }
  const data = card.data;
  // The card's `ai` is a JID with no matching mock AI row; the seeded
  // audit trail already treats `apr-42` as the Dev AI's approval, so the
  // read model resolves to the first mock AI. That keeps the AI panel's
  // rules list (`?aiId=ai-mock-dev`) showing the rule an `approve_always`
  // decision creates.
  const owner = state.ais.find((item) => item.jid === data.ai) ?? state.ais[0];
  return {
    id: row.id,
    aiId: owner?.id ?? data.ai,
    // T-0100: the seeded card lives in the personal chat with the AI's
    // owner (`groupId: null`), and the mock action is always-eligible.
    groupId: null,
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
    alwaysEligible: true,
  };
}

function isPendingApproval(approval: { status: string; expiresAt: string }): boolean {
  return approval.status === 'pending' && new Date(approval.expiresAt).getTime() > Date.now();
}
