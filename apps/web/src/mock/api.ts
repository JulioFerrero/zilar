import type { ChatEntry, Connection, Contact, Machine, Me, PublicAi } from '@/lib/api';
import { RESERVED_HANDLES } from '@/lib/handles';
import { currentUserId, PEOPLE } from './ids';
import { mockChats } from './chats';
import { mockGroupDetails } from './groups';
import { mockMessages } from './messages';
import {
  approvalCard,
  MOCK_TOPIC_NOT_FOUND,
  mockDemoStickerArt,
  mockDemoStickerPacks,
  mockGifItems,
} from './helpers';
import {
  mockTopicAisById,
  mockTopicChats,
  mockTopicMembersById,
  mockTopicMessages,
} from './topics';

/** UUIDs for user-created mock packs/stickers (node + browsers both have it). */
function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

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
  // T-0116: custom group roles of the Dev team group, with their holders.
  groupRoles: MockGroupRole[];
  nextRoleSequence: number;
  // T-0133: join-by-link attempts per invite link, for the mock's 429
  // `rate_limited` window (20 attempts per link per page load, so the join
  // page can reach its rate-limited state in mock mode). Reset with the
  // rest of the state by `resetMockApi`.
  joinAttempts: Map<string, number>;
  // T-0113: per-chat prefs (mute/archive/pin) in memory for the page load.
  chatPrefs: MockChatPref[];
  // T-0462: the caller's global background default, in memory for the page
  // load. All null means unset, so chats fall back to the slate grid.
  backgroundDefault: {
    backgroundPreset: string | null;
    backgroundImageId: string | null;
    backgroundDim: number | null;
  };
  // T-0237: chat folders in memory for the page load, seeded on first GET
  // with Personal and AIs (mirroring the server's seed).
  chatFolders: MockChatFolder[] | undefined;
  // T-0119: push devices and the previews setting in memory for the page
  // load. The mock has no XMPP session, so the enable IQ step is skipped.
  pushDevices: MockPushDevice[];
  pushShowPreviews: boolean;
  nextPushDeviceSequence: number;
  // T-0114: pinned messages in memory for the page load, keyed by the chat
  // id the client names the chat with (the mock has no JID access model).
  pins: MockPin[];
  nextPinSequence: number;
  // T-0107: tools and routines in memory for the page load. The mock has
  // one user (the group owner and AI owner), so every action succeeds —
  // like the real server's manager check with the mock's single user.
  tools: MockTool[];
  routines: MockRoutine[];
  runs: MockRun[];
  nextToolSequence: number;
  nextRoutineSequence: number;
  nextRunSequence: number;
  // T-0121: sticker packs in memory for the page load (demo packs seeded),
  // the panel pack ids in order, and favorite sticker ids (oldest first).
  stickerPacks: MockStickerPack[];
  stickerPanel: string[];
  stickerFavorites: string[];
  nextStickerPackSequence: number;
  nextStickerSequence: number;
  // T-0163: contact requests in memory for the page load. The mock has one
  // user plus the PEOPLE directory: `taken_user` resolves to Ana (always
  // taken), every other valid free handle resolves to a synthetic stranger,
  // and invalid shapes 404 like the server.
  contactRequests: MockContactRequest[];
  nextContactRequestSequence: number;
  // T-0235: blocked people in memory for the page load.
  blockedUsers: MockBlockedUser[];
  // T-0443: the AI's memory per `${chat}|${ai}`, seeded on first read. The
  // mock has one user (the AI owner), so every memory is changeable.
  aiMemory: Map<string, MockAiMemory>;
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
  // T-0116: attached role ids, and the approver role id (null = owners and
  // admins only).
  roleIds: string[];
  approverRoleId: string | null;
}

// T-0116: one custom group role, mirroring the server's `group_roles` plus
// its holder ids.
interface MockGroupRole {
  id: string;
  groupId: string;
  name: string;
  memberIds: string[];
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

// T-0237: one chat folder row, mirroring the server's `chat_folders`.
interface MockChatFolder {
  id: string;
  name: string;
  icon: string;
  position: number;
  includeTypes: string[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

function seedChatFolders(): MockChatFolder[] {
  return [
    {
      id: 'mock-folder-personal',
      name: 'Personal',
      icon: 'user',
      position: 0,
      includeTypes: ['dm'],
      includeChats: [],
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    },
    {
      id: 'mock-folder-ais',
      name: 'AIs',
      icon: 'bot',
      position: 1,
      includeTypes: ['ai'],
      includeChats: [],
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    },
  ];
}

// T-0113: one chat-preference row, mirroring the server's `chat_prefs`.
interface MockChatPref {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
  // T-0462: per-chat background override; all null means inherit the default.
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
}

// T-0119: one push device row, mirroring the server's device view (labels
// and dates only, never the endpoint or keys).
interface MockPushDevice {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  inactive: boolean;
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

// T-0443: one chat's AI memory in memory for the page load, keyed by
// `${chat}|${ai}` and seeded on first read.
interface MockAiMemory {
  facts: { id: string; text: string }[];
  lines: string[];
}

// T-0121: one sticker pack row, mirroring the server's `sticker_packs` plus
// its stickers. Seeded with the two demo packs so the panel and discover
// keep working with no server.
interface MockSticker {
  id: string;
  packId: string;
  emoji: string | null;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  url: string;
  /** T-0123: the Telegram `file_unique_id` of an imported sticker. */
  sourceId?: string;
}

interface MockStickerPack {
  id: string;
  ownerId: string;
  title: string;
  visibility: 'private' | 'server';
  /** T-0123: `telegram:<name>` for imported packs; absent otherwise. */
  importedFrom?: string;
  stickers: MockSticker[];
  createdAt: string;
  updatedAt: string;
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

// T-0163: one pending contact request. `fromUserId`/`toUserId` mirror the
// server's `contact_requests` row; status is `pending` until decided.
interface MockContactRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
}

// T-0235: one blocked person, in blocker order. `blockedAt` keeps the
// newest-first list order the server answers with.
interface MockBlockedUser {
  userId: string;
  blockedAt: string;
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

// T-0107: one tool with its version history, mirroring the server's
// `ai_tools` + `ai_tool_versions` (no source on the list rows).
interface MockToolVersion {
  id: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  createdAt: string;
}

interface MockTool {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  approvedHosts: string[];
  versions: MockToolVersion[];
  deleted: boolean;
}

// T-0107: one routine row, mirroring the server's `routines` (no tool source).
interface MockRoutine {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  title: string;
  schedule: unknown;
  status: 'active' | 'paused' | 'needs_approval';
  pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  approvedHosts: string[];
  deleted: boolean;
}

// T-0107: one recorded run row, mirroring the server's `ai_tool_runs`.
interface MockRun {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: string;
}

// T-0107: one AI with two tools (two versions each): the prices tool in
// the bug topic and the notes tool in General. Sources are plain mock
// code; hosts show a declared set and (for prices) an approved subset.
function seedTools(): MockTool[] {
  return [
    {
      id: 'tool-mock-prices',
      aiId: 'dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-bug',
      name: 'prices',
      description: 'Fetches the morning prices.',
      approvedHosts: ['api.example.com'],
      versions: [
        {
          id: 'tool-mock-prices-v1',
          version: 1,
          source: 'export function run() {\n  return fetchPrices(["gold"]);\n}',
          hosts: [],
          message: 'First version',
          createdBy: currentUserId,
          createdAt: '2026-09-28T09:00:00.000Z',
        },
        {
          id: 'tool-mock-prices-v2',
          version: 2,
          source:
            'export function run(input) {\n  const symbols = input?.symbols ?? ["gold", "BTC"];\n  return fetchPrices(symbols);\n}',
          hosts: ['api.example.com', 'prices.example.com'],
          message: 'Add the price host',
          createdBy: currentUserId,
          createdAt: '2026-09-29T09:00:00.000Z',
        },
      ],
      deleted: false,
    },
    {
      id: 'tool-mock-notes',
      aiId: 'dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-general',
      name: 'notes',
      description: 'Formats the standup notes.',
      approvedHosts: [],
      versions: [
        {
          id: 'tool-mock-notes-v1',
          version: 1,
          source: 'export function run(input) {\n  return formatNotes(input);\n}',
          hosts: [],
          message: 'First version',
          createdBy: currentUserId,
          createdAt: '2026-09-27T09:00:00.000Z',
        },
        {
          id: 'tool-mock-notes-v2',
          version: 2,
          source: 'export function run(input) {\n  return formatNotes(input, { trim: true });\n}',
          hosts: [],
          message: 'Trim long lines',
          createdBy: currentUserId,
          createdAt: '2026-09-28T09:00:00.000Z',
        },
      ],
      deleted: false,
    },
  ];
}

// T-0107: one active routine (morning prices) and one paused routine
// (standup notes), mirroring the server's rows.
function seedRoutines(): MockRoutine[] {
  return [
    {
      id: 'routine-mock-morning',
      aiId: 'dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-bug',
      toolId: 'tool-mock-prices',
      title: 'Morning prices',
      schedule: {
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [1, 2, 3, 4, 5],
      },
      status: 'active',
      pausedReason: null,
      nextRunAt: '2026-10-01T09:00:00.000Z',
      lastRunAt: '2026-09-30T09:00:00.000Z',
      lastStatus: 'ok',
      approvedHosts: ['api.example.com'],
      deleted: false,
    },
    {
      id: 'routine-mock-standup',
      aiId: 'dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-general',
      toolId: 'tool-mock-notes',
      title: 'Standup notes',
      schedule: { kind: 'interval', everyMinutes: 1440 },
      status: 'paused',
      pausedReason: 'user',
      nextRunAt: '2026-10-01T09:30:00.000Z',
      lastRunAt: '2026-09-29T09:30:00.000Z',
      lastStatus: 'ok',
      approvedHosts: [],
      deleted: false,
    },
  ];
}

function seedRuns(): MockRun[] {
  return [
    {
      id: 'run-mock-1',
      toolId: 'tool-mock-prices',
      version: 2,
      trigger: 'routine',
      status: 'ok',
      errorKind: null,
      durationMs: 240,
      fetchCount: 2,
      outputText: 'gold 4300, BTC 114000',
      createdAt: '2026-09-30T09:00:00.000Z',
    },
    {
      id: 'run-mock-2',
      toolId: 'tool-mock-prices',
      version: 1,
      trigger: 'manual',
      status: 'error',
      errorKind: 'fetch_failed',
      durationMs: 1200,
      fetchCount: 0,
      outputText: null,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
  ];
}

function currentVersionOf(tool: MockTool): MockToolVersion {
  const latest = tool.versions[tool.versions.length - 1];
  if (latest === undefined) {
    throw new Error('mock tools always carry versions');
  }
  return latest;
}

function lastRunStatusOf(toolId: string): 'ok' | 'error' | null {
  const runs = state.runs
    .filter((run) => run.toolId === toolId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return runs[0]?.status ?? null;
}

function toolListRow(tool: MockTool): Record<string, unknown> {
  const current = currentVersionOf(tool);
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: current.version,
    hosts: current.hosts,
    approvedHosts: tool.approvedHosts,
    lastRunStatus: lastRunStatusOf(tool.id),
    updatedAt: current.createdAt,
    scope: tool.groupId === null ? 'personal' : 'group',
  };
}

function toolDetailRow(tool: MockTool): Record<string, unknown> {
  const current = currentVersionOf(tool);
  return { ...toolListRow(tool), source: current.source };
}

function routineRow(routine: MockRoutine): Record<string, unknown> {
  const tool = state.tools.find((item) => item.id === routine.toolId);
  return {
    id: routine.id,
    aiId: routine.aiId,
    groupId: routine.groupId,
    topicId: routine.topicId,
    toolId: routine.toolId,
    title: routine.title,
    toolName: tool?.name ?? '',
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt,
    lastRunAt: routine.lastRunAt,
    lastStatus: routine.lastStatus,
    approvedHosts: routine.approvedHosts,
    scope: routine.groupId === null ? 'personal' : 'group',
  };
}

function findTool(id: string): MockTool | undefined {
  return state.tools.find((tool) => tool.id === id && !tool.deleted);
}

function findRoutine(id: string): MockRoutine | undefined {
  return state.routines.find((routine) => routine.id === id && !routine.deleted);
}

// Every seeded AI id the mock tools/routines may belong to. The mock has
// one user (the owner), so `/ais/:id/tools` answers for any AI row.
function toolAiIds(): Set<string> {
  return new Set([...state.ais.map((ai) => ai.id), 'dev-1', 'qa-1']);
}

// T-0107: tool and routine routes. The mock has one user (the group owner
// and AI owner), so every read and every manager write succeeds; unknown
// ids 404 like the real server's same-shape 404.
function toolRoutes(
  head: string,
  first: string | undefined,
  second: string | undefined,
  segments: string[],
  method: string,
  init: RequestInit,
): Response | undefined {
  if (head === 'ais' && second === 'tools' && method === 'GET') {
    const aiId = decodeURIComponent(first ?? '');
    if (!toolAiIds().has(aiId)) {
      return notFound('AI not found');
    }
    return jsonResponse(
      state.tools.filter((tool) => !tool.deleted && tool.aiId === aiId).map(toolListRow),
    );
  }
  if (head === 'groups' && second === 'tools' && method === 'GET') {
    const groupId = decodeURIComponent(first ?? '');
    return jsonResponse(
      state.tools.filter((tool) => !tool.deleted && tool.groupId === groupId).map(toolListRow),
    );
  }
  if (head === 'groups' && second === 'routines' && method === 'GET') {
    const groupId = decodeURIComponent(first ?? '');
    return jsonResponse(
      state.routines
        .filter((routine) => !routine.deleted && routine.groupId === groupId)
        .map(routineRow),
    );
  }
  if (head === 'ais' && second === 'routines' && method === 'GET') {
    const aiId = decodeURIComponent(first ?? '');
    if (!toolAiIds().has(aiId)) {
      return notFound('AI not found');
    }
    return jsonResponse(
      state.routines.filter((routine) => !routine.deleted && routine.aiId === aiId).map(routineRow),
    );
  }
  if (head === 'tools' && first !== undefined) {
    const tool = findTool(decodeURIComponent(first));
    if (tool === undefined) {
      return notFound('Tool not found');
    }
    if (second === undefined && method === 'GET') {
      return jsonResponse(toolDetailRow(tool));
    }
    if (second === 'versions' && segments[3] === undefined && method === 'GET') {
      return jsonResponse(
        [...tool.versions].reverse().map((version) => ({
          id: version.id,
          toolId: tool.id,
          version: version.version,
          message: version.message,
          hosts: version.hosts,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
        })),
      );
    }
    if (second === 'versions' && segments[3] !== undefined && method === 'GET') {
      const wanted = Number(segments[3]);
      const version = tool.versions.find((item) => item.version === wanted);
      if (version === undefined) {
        return notFound('Tool version not found');
      }
      return jsonResponse({
        id: version.id,
        toolId: tool.id,
        version: version.version,
        source: version.source,
        hosts: version.hosts,
        message: version.message,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
      });
    }
    if (second === 'runs' && method === 'GET') {
      return jsonResponse(
        state.runs
          .filter((run) => run.toolId === tool.id)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
          .slice(0, 20),
      );
    }
    if (second === 'revert' && method === 'POST') {
      const body = readJsonBody(init);
      const wanted = typeof body.version === 'number' ? body.version : 0;
      const old = tool.versions.find((item) => item.version === wanted);
      if (old === undefined) {
        return notFound('Tool version not found');
      }
      const next = currentVersionOf(tool).version + 1;
      const created: MockToolVersion = {
        id: `tool-mock-${state.nextToolSequence}`,
        version: next,
        source: old.source,
        hosts: [...old.hosts],
        message: `Revert to v${old.version}`,
        createdBy: currentUserId,
        createdAt: new Date().toISOString(),
      };
      state.nextToolSequence += 1;
      tool.versions = [...tool.versions, created];
      return jsonResponse({
        id: created.id,
        toolId: tool.id,
        version: created.version,
        message: created.message,
        hosts: created.hosts,
        createdBy: created.createdBy,
        createdAt: created.createdAt,
        toolName: tool.name,
      });
    }
    if (second === 'run' && method === 'POST') {
      const current = currentVersionOf(tool);
      const run: MockRun = {
        id: `run-mock-${state.nextRunSequence}`,
        toolId: tool.id,
        version: current.version,
        trigger: 'manual',
        status: 'ok',
        errorKind: null,
        durationMs: 42,
        fetchCount: current.hosts.length,
        outputText: `mock output of ${tool.name} v${current.version}`,
        createdAt: new Date().toISOString(),
      };
      state.nextRunSequence += 1;
      state.runs = [...state.runs, run];
      return jsonResponse({
        ok: true as const,
        output: { text: run.outputText ?? '' },
        logs: '',
        durationMs: run.durationMs,
        fetchCount: run.fetchCount,
      });
    }
    if (second === undefined && method === 'DELETE') {
      // Idempotent, like the real server: re-deleting answers 204, and the
      // tool's routines are removed with it.
      tool.deleted = true;
      for (const routine of state.routines) {
        if (routine.toolId === tool.id && !routine.deleted) {
          routine.deleted = true;
        }
      }
      return noContent();
    }
    return notImplemented();
  }
  if (head === 'routines' && first !== undefined && second === undefined && method === 'DELETE') {
    // Idempotent, like the real server: a missing id 404s, a deleted one 204s.
    const raw = state.routines.find((routine) => routine.id === decodeURIComponent(first));
    if (raw === undefined) {
      return notFound('Routine not found');
    }
    raw.deleted = true;
    return noContent();
  }
  if (head === 'routines' && first !== undefined && (second === 'pause' || second === 'resume')) {
    const routine = findRoutine(decodeURIComponent(first));
    if (routine === undefined) {
      return notFound('Routine not found');
    }
    if (method !== 'POST') {
      return notImplemented();
    }
    if (second === 'pause') {
      if (routine.status === 'active') {
        routine.status = 'paused';
        routine.pausedReason = 'user';
      }
      return jsonResponse(routineRow(routine));
    }
    if (routine.status === 'needs_approval') {
      return jsonResponse(
        { error: { code: 'needs_approval', message: 'The routine needs re-approval' } },
        409,
      );
    }
    if (routine.status === 'paused') {
      routine.status = 'active';
      routine.pausedReason = null;
    }
    return jsonResponse(routineRow(routine));
  }
  return undefined;
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
      // T-0116: the private hiring topic starts with the Designers role
      // attached (Ana + you hold it), so the pickers show real data.
      roleIds: info.id === 't-devteam-hiring' ? ['role-designers'] : [],
      approverRoleId: info.id === 't-devteam-ui' ? 'role-designers' : null,
    };
  });
}

// T-0116: the Dev team group's seeded roles. The mock user is the group
// owner, so every write succeeds — like the real server's manager check
// with the mock's single user.
function seedGroupRoles(): MockGroupRole[] {
  return [
    {
      id: 'role-designers',
      groupId: 'g-devteam',
      name: 'Designers',
      memberIds: ['u-you', 'u-ana'],
    },
    { id: 'role-devs', groupId: 'g-devteam', name: 'Devs', memberIds: ['u-you', 'u-luis'] },
  ];
}

function roleToView(role: MockGroupRole): Record<string, unknown> {
  return {
    id: role.id,
    name: role.name,
    members: role.memberIds.map((userId) => ({ userId, name: mockPersonName(userId) })),
  };
}

function findRole(id: string): MockGroupRole | undefined {
  return state.groupRoles.find((role) => role.id === id);
}

function topicToView(topic: MockTopic): Record<string, unknown> {
  const roleViews = topic.roleIds
    .map((roleId) => findRole(roleId))
    .filter((role): role is MockGroupRole => role !== undefined)
    .map((role) => ({ id: role.id, name: role.name, memberCount: role.memberIds.length }));
  const approver = topic.approverRoleId === null ? null : findRole(topic.approverRoleId);
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
        ? new Set([
            ...topic.memberIds,
            ...roleViews.flatMap((role) => findRole(role.id)?.memberIds ?? []),
          ]).size
        : (mockGroupDetails['c-devteam']?.members.length ?? topic.memberIds.length),
    ais: topic.aiIds.map((aiId) => ({ id: aiId, name: mockAiName(aiId) })),
    roles: roleViews,
    approverRole:
      approver === undefined || approver === null ? null : { id: approver.id, name: approver.name },
  };
}

function findTopic(id: string): MockTopic | undefined {
  return state.topics.find((topic) => topic.id === id);
}

function glyphForTopic(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

function hasMockControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
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

// T-0443: the AI's seeded memory for a chat's first read in mock mode: two
// pinned facts and three cover lines (one summary, two messages).
function seedAiMemory(): MockAiMemory {
  return {
    facts: [
      { id: 'fact-1', text: 'Julio prefers short answers.' },
      { id: 'fact-2', text: 'The launch is on Friday.' },
    ],
    lines: [
      '#0-15 Summary: the team agreed on the launch plan and pricing.',
      '#16 2026-10-01 Julio: Let us keep the pricing simple.',
      '#17 2026-10-01 Dev-1: Agreed, two tiers only.',
    ],
  };
}

function seedState(): MockState {
  return {
    me: {
      id: currentUserId,
      email: 'you@zilar.test',
      name: 'You',
      image: null,
      // T-0163: the mock user starts handle-less so the handle gate can be
      // exercised; claiming sets it below.
      handle: null,
      jid: `${currentUserId}@zilar.test`,
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
        name: 'dev-mac',
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
    groupRoles: seedGroupRoles(),
    nextRoleSequence: 3,
    joinAttempts: new Map(),
    chatPrefs: [],
    backgroundDefault: { backgroundPreset: null, backgroundImageId: null, backgroundDim: null },
    chatFolders: undefined,
    pushDevices: [],
    pushShowPreviews: true,
    nextPushDeviceSequence: 1,
    pins: seedPins(),
    nextPinSequence: 3,
    tools: seedTools(),
    routines: seedRoutines(),
    runs: seedRuns(),
    nextToolSequence: 100,
    nextRoutineSequence: 100,
    nextRunSequence: 100,
    stickerPacks: seedStickerPacks(),
    stickerPanel: mockDemoStickerPacks().map((pack) => pack.id),
    stickerFavorites: [],
    nextStickerPackSequence: 1,
    nextStickerSequence: 1,
    contactRequests: [],
    nextContactRequestSequence: 1,
    blockedUsers: [],
    aiMemory: new Map(),
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

function notFound(message: string): Response {
  return jsonResponse({ error: { code: 'not_found', message } }, 404);
}

// T-0163: who a handle resolves to in mock mode. `taken_user` is Ana (the
// handle the check endpoint reports as taken); every other valid-shaped,
// non-reserved handle is a synthetic stranger named after the handle, so
// the Add-contact card always has someone to show. Invalid shapes and
// reserved words resolve to null (the route answers the same 404).
function mockHandleUserId(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@/, '');
  const normalized = trimmed.toLowerCase();
  if (RESERVED_HANDLES.has(normalized)) {
    return null;
  }
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(trimmed)) {
    return null;
  }
  if (normalized === 'taken_user') {
    return PEOPLE.ana!.id;
  }
  return `u-handle-${normalized}`;
}

function mockHandleProfile(raw: string): {
  userId: string;
  name: string;
  handle: string;
  image: null;
  relation: 'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';
} | null {
  const userId = mockHandleUserId(raw);
  if (userId === null) {
    return null;
  }
  const trimmed = raw.trim().replace(/^@/, '');
  const person = Object.values(PEOPLE).find((entry) => entry.id === userId);
  const name =
    person?.name ?? trimmed.charAt(0).toUpperCase() + trimmed.slice(1).replace(/_/g, ' ');
  if (userId === currentUserId) {
    return { userId, name, handle: trimmed, image: null, relation: 'self' };
  }
  if (state.blockedUsers.some((entry) => entry.userId === userId)) {
    return { userId, name, handle: trimmed, image: null, relation: 'blocked' };
  }
  const outgoing = state.contactRequests.find(
    (row) =>
      row.status === 'pending' && row.fromUserId === currentUserId && row.toUserId === userId,
  );
  const incoming = state.contactRequests.find(
    (row) =>
      row.status === 'pending' && row.fromUserId === userId && row.toUserId === currentUserId,
  );
  return {
    userId,
    name,
    handle: trimmed,
    image: null,
    relation:
      outgoing !== undefined
        ? 'request_sent'
        : incoming !== undefined
          ? 'request_received'
          : 'none',
  };
}

function mockContactRequestRow(row: MockContactRequest): {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  createdAt: string;
} {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function mockContactPerson(userId: string): {
  userId: string;
  name: string;
  handle: string | null;
  image: null;
} {
  const person = Object.values(PEOPLE).find((entry) => entry.id === userId);
  const profile = userId === currentUserId ? null : mockHandleProfileForId(userId);
  return {
    userId,
    name: userId === currentUserId ? state.me.name : (person?.name ?? profile?.name ?? userId),
    handle:
      userId === currentUserId
        ? (state.me.handle ?? null)
        : person !== undefined
          ? mockPersonHandle(person.id)
          : (profile?.handle ?? null),
    image: null,
  };
}

// The handle a known mock person is reachable under: Ana owns `taken_user`
// (the always-taken handle); everyone else keeps a handle derived from
// their name.
function mockPersonHandle(userId: string): string | null {
  if (userId === PEOPLE.ana!.id) {
    return 'taken_user';
  }
  const person = Object.values(PEOPLE).find((entry) => entry.id === userId);
  if (person === undefined) {
    return null;
  }
  return person.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

function mockHandleProfileForId(userId: string): { name: string; handle: string } | null {
  if (userId.startsWith('u-handle-')) {
    const handle = userId.slice('u-handle-'.length);
    return { name: handle.charAt(0).toUpperCase() + handle.slice(1).replace(/_/g, ' '), handle };
  }
  return null;
}

function mockContactRequestList(): {
  incoming: Array<ReturnType<typeof mockContactRequestView>>;
  outgoing: Array<ReturnType<typeof mockContactRequestView>>;
} {
  const pending = state.contactRequests
    .filter((row) => row.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return {
    incoming: pending.filter((row) => row.toUserId === currentUserId).map(mockContactRequestView),
    outgoing: pending.filter((row) => row.fromUserId === currentUserId).map(mockContactRequestView),
  };
}

function mockContactRequestView(row: MockContactRequest): {
  id: string;
  status: string;
  createdAt: string;
  other: ReturnType<typeof mockContactPerson>;
} {
  const otherId = row.fromUserId === currentUserId ? row.toUserId : row.fromUserId;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    other: mockContactPerson(otherId),
  };
}

function createMockContactRequest(init: RequestInit): Response {
  const body = readJsonBody(init);
  const raw = typeof body.handle === 'string' ? body.handle : '';
  const userId = mockHandleUserId(raw);
  if (userId === null) {
    return jsonResponse(
      { error: { code: 'not_found', message: 'No user with that username' } },
      404,
    );
  }
  if (userId === currentUserId) {
    return jsonResponse(
      { error: { code: 'invalid_request', message: 'You cannot add yourself' } },
      400,
    );
  }
  const pending = state.contactRequests.find(
    (row) =>
      row.status === 'pending' &&
      ((row.fromUserId === currentUserId && row.toUserId === userId) ||
        (row.fromUserId === userId && row.toUserId === currentUserId)),
  );
  if (pending !== undefined) {
    if (pending.fromUserId === currentUserId) {
      return jsonResponse(
        { error: { code: 'request_exists', message: 'A request is already pending' } },
        409,
      );
    }
    // The other side already asked: 200 with the existing request, like the
    // server, so the dialog can offer Accept.
    return jsonResponse({ request: mockContactRequestRow(pending), incoming: true }, 200);
  }
  const row: MockContactRequest = {
    id: `cr-${state.nextContactRequestSequence++}`,
    fromUserId: currentUserId,
    toUserId: userId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  state.contactRequests.push(row);
  return jsonResponse({ request: mockContactRequestRow(row) }, 201);
}

function decideMockContactRequest(
  id: string,
  status: 'accepted' | 'declined' | 'cancelled',
): Response {
  const row = state.contactRequests.find((entry) => entry.id === id);
  const mine =
    row !== undefined &&
    (status === 'cancelled' ? row.fromUserId === currentUserId : row.toUserId === currentUserId);
  if (row === undefined || !mine || row.status !== 'pending') {
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
  }
  row.status = status;
  return jsonResponse({ request: mockContactRequestRow(row) });
}

// T-0235: blocks in memory for the page load. Blocking is idempotent, like
// the server; unblocking someone never blocked still answers success.
function mockBlockList(): Array<{
  userId: string;
  name: string;
  handle: string | null;
  image: null;
  jid: string | null;
}> {
  const ordered = [...state.blockedUsers].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt));
  return ordered.map((entry) => {
    const profile = mockHandleProfileForId(entry.userId);
    const person = Object.values(PEOPLE).find((item) => item.id === entry.userId);
    const handle = mockPersonHandle(entry.userId) ?? profile?.handle ?? null;
    return {
      userId: entry.userId,
      name: person?.name ?? profile?.name ?? entry.userId,
      handle,
      image: null,
      jid: entry.userId === currentUserId ? (state.me.jid ?? null) : `${entry.userId}@zilar.test`,
    };
  });
}

// T-0163: mock handle availability. `taken-user` is always taken; reserved
// words and bad shapes map like the server (reserved-first, like
// `classifyHandle`); everything else is free. The reserved list is the
// shared one (`lib/handles.ts`), not a copy.
function mockCheckHandle(raw: string): { available: boolean; reason?: string } {
  const normalized = raw.toLowerCase();
  if (RESERVED_HANDLES.has(normalized)) {
    return { available: false, reason: 'reserved' };
  }
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(raw)) {
    return { available: false, reason: 'invalid' };
  }
  if (normalized === 'taken_user') {
    return { available: false, reason: 'taken' };
  }
  return { available: true };
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

// T-0120: the two demo packs as API rows (200 px generated stickers at
// relative file URLs, so sending a demo sticker passes `StickerSchema`).
function mockStickerPacks(): unknown[] {
  const now = new Date().toISOString();
  return mockDemoStickerPacks().map((pack) => ({
    id: pack.id,
    ownerId: currentUserId,
    title: pack.title,
    visibility: 'server',
    stickers: pack.stickers.map((sticker) => ({
      id: sticker.id,
      packId: pack.id,
      emoji: sticker.emoji,
      mime: 'image/png',
      width: 200,
      height: 200,
      bytes: 1024,
      url: sticker.url,
    })),
    createdAt: now,
    updatedAt: now,
  }));
}

function seedStickerPacks(): MockStickerPack[] {
  return (mockStickerPacks() as MockStickerPack[]).map((pack) => ({
    ...pack,
    stickers: pack.stickers.map((sticker) => ({ ...sticker })),
  }));
}

function mockStickerFileUrl(stickerId: string): string {
  return `/api/stickers/${stickerId}/file`;
}

function findMockSticker(stickerId: string): MockSticker | undefined {
  for (const pack of state.stickerPacks) {
    const sticker = pack.stickers.find((row) => row.id === stickerId);
    if (sticker !== undefined) {
      return sticker;
    }
  }
  return undefined;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = init.headers;
  if (headers === undefined) {
    return undefined;
  }
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string>;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === wanted && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function invalidRequest(message: string): Response {
  return jsonResponse({ error: { code: 'invalid_request', message } }, 400);
}

function touchPack(pack: MockStickerPack): void {
  pack.updatedAt = new Date().toISOString();
}

// T-0121: creates a pack from a JSON body; mirrors the server's validation.
function createMockStickerPack(init: RequestInit): Response {
  const body = readJsonBody(init);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '' || title.length > 60) {
    return invalidRequest('title must be 1-60 characters');
  }
  const visibility = body.visibility === undefined ? 'private' : body.visibility;
  if (visibility !== 'private' && visibility !== 'server') {
    return invalidRequest('visibility must be private or server');
  }
  const now = new Date().toISOString();
  state.nextStickerPackSequence += 1;
  // UUIDs, like the real server: the mock send path validates the payload
  // against `StickerSchema`, which requires UUID pack/sticker ids — so a
  // sticker from a user-created mock pack sends exactly like a real one.
  const pack: MockStickerPack = {
    id: randomUUID(),
    ownerId: currentUserId,
    title,
    visibility,
    stickers: [],
    createdAt: now,
    updatedAt: now,
  };
  state.stickerPacks = [...state.stickerPacks, pack];
  state.stickerPanel = [...state.stickerPanel, pack.id];
  return jsonResponse(pack, 201);
}

// T-0121: edits title/visibility/sticker order of a pack, like the server.
function patchMockStickerPack(packId: string, init: RequestInit): Response {
  const pack = state.stickerPacks.find((row) => row.id === packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  const body = readJsonBody(init);
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title === '' || title.length > 60) {
      return invalidRequest('title must be 1-60 characters');
    }
    pack.title = title;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== 'private' && body.visibility !== 'server') {
      return invalidRequest('visibility must be private or server');
    }
    pack.visibility = body.visibility;
  }
  if (body.order !== undefined) {
    if (!Array.isArray(body.order)) {
      return invalidRequest('order must list every sticker exactly once');
    }
    const ids = new Set(pack.stickers.map((sticker) => sticker.id));
    const order = body.order.filter((id): id is string => typeof id === 'string');
    if (order.length !== pack.stickers.length || !order.every((id) => ids.has(id))) {
      return invalidRequest('order must list every sticker exactly once');
    }
    const byId = new Map(pack.stickers.map((sticker) => [sticker.id, sticker]));
    pack.stickers = order.map((id) => byId.get(id)!);
  }
  touchPack(pack);
  return jsonResponse(pack);
}

// T-0121: deletes a pack, its panel link and any favorites of its stickers.
function deleteMockStickerPack(packId: string): Response {
  const pack = state.stickerPacks.find((row) => row.id === packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  const stickerIds = new Set(pack.stickers.map((sticker) => sticker.id));
  state.stickerPacks = state.stickerPacks.filter((row) => row.id !== packId);
  state.stickerPanel = state.stickerPanel.filter((id) => id !== packId);
  state.stickerFavorites = state.stickerFavorites.filter((id) => !stickerIds.has(id));
  return jsonResponse({
    warning:
      'The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker.',
  });
}

// T-0121: mints a sticker row for an upload. The bytes are not stored (the
// editor previews them locally); the row mirrors the server's shape with a
// same-origin file URL.
function uploadMockSticker(packId: string, init: RequestInit): Response {
  const pack = state.stickerPacks.find((row) => row.id === packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  if (pack.stickers.length >= 120) {
    return jsonResponse(
      { error: { code: 'pack_full', message: 'A pack holds at most 120 stickers' } },
      400,
    );
  }
  const emojiHeader = headerOf(init, 'x-emoji');
  // The client percent-encodes the emoji for the latin1 header; decode it
  // like the real server (invalid escapes fall back to the raw value, which
  // the length cap then trims).
  let emojiValue = emojiHeader ?? '';
  if (emojiValue.includes('%')) {
    try {
      emojiValue = decodeURIComponent(emojiValue.slice(0, 64));
    } catch {
      emojiValue = '';
    }
  }
  const emoji = emojiValue !== '' ? emojiValue.slice(0, 8) : null;
  const contentType = headerOf(init, 'content-type') ?? '';
  const mime = contentType === 'image/png' ? 'image/png' : 'image/webp';
  const body = init.body as unknown;
  const bytes =
    typeof body === 'object' && body !== null && typeof (body as Blob).size === 'number'
      ? (body as Blob).size
      : 1024;
  state.nextStickerSequence += 1;
  const sticker: MockSticker = {
    id: randomUUID(),
    packId,
    emoji,
    mime,
    width: 200,
    height: 200,
    bytes,
    url: '',
  };
  sticker.url = mockStickerFileUrl(sticker.id);
  pack.stickers = [...pack.stickers, sticker];
  touchPack(pack);
  return jsonResponse(sticker, 201);
}

// T-0121: deletes one sticker (and its favorites) from a pack.
function deleteMockSticker(packId: string, stickerId: string): Response {
  const pack = state.stickerPacks.find((row) => row.id === packId);
  const sticker = pack?.stickers.find((row) => row.id === stickerId);
  if (pack === undefined || sticker === undefined) {
    return notFound('Sticker not found');
  }
  pack.stickers = pack.stickers.filter((row) => row.id !== stickerId);
  state.stickerFavorites = state.stickerFavorites.filter((id) => id !== stickerId);
  touchPack(pack);
  return jsonResponse({ ok: true });
}

// T-0123: the fake Telegram import. The input names the Telegram pack; the
// pack content is generated stickers (copied from the first demo pack's
// art), so mock mode shows a real imported pack without a server.
function importMockTelegramPack(init: RequestInit): Response {
  const body = readJsonBody(init);
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (input === '') {
    return invalidRequest('Give a sticker pack link or name');
  }
  if (input === '__mock_unavailable') {
    return jsonResponse(
      { error: { code: 'import_unavailable', message: 'Telegram import is not configured' } },
      501,
    );
  }
  if (input === '__mock_missing') {
    return notFound('Sticker pack not found');
  }
  const nameMatch = /([A-Za-z0-9_]{1,64})$/.exec(input);
  const name = nameMatch?.[1] ?? 'Imported';
  const importedFrom = `telegram:${name}`;
  const now = new Date().toISOString();
  let pack = state.stickerPacks.find((row) => row.importedFrom === importedFrom);
  if (pack === undefined) {
    pack = {
      id: randomUUID(),
      ownerId: currentUserId,
      title: `${name} (Telegram)`.slice(0, 60),
      visibility: 'private',
      importedFrom,
      stickers: [],
      createdAt: now,
      updatedAt: now,
    };
    state.stickerPacks = [...state.stickerPacks, pack];
    state.stickerPanel = [...state.stickerPanel, pack.id];
  }
  const demoArt = state.stickerPacks[0]?.stickers ?? [];
  let imported = 0;
  for (const art of demoArt.slice(0, 6)) {
    if (pack.stickers.length >= 120) {
      break;
    }
    if (pack.stickers.some((row) => row.sourceId === art.id)) {
      continue;
    }
    const sticker: MockSticker = {
      id: randomUUID(),
      packId: pack.id,
      emoji: art.emoji,
      mime: 'image/png',
      width: 200,
      height: 200,
      bytes: 1024,
      url: '',
      sourceId: art.id,
    };
    sticker.url = mockStickerFileUrl(sticker.id);
    pack.stickers = [...pack.stickers, sticker];
    imported += 1;
  }
  touchPack(pack);
  return jsonResponse({
    pack,
    imported,
    skippedAnimated: 1,
    skippedInvalid: 0,
    ...(input === '__mock_partial' ? { partial: true as const } : {}),
  });
}

// T-0121: favorites in memory; the 200 cap and idempotent star match the server.
function favoriteRows(): MockSticker[] {
  const rows: MockSticker[] = [];
  for (const id of state.stickerFavorites) {
    const sticker = findMockSticker(id);
    if (sticker !== undefined) {
      rows.push(sticker);
    }
  }
  return rows;
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
    jid: `ai-${id}@zilar.test`,
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

// T-0133: the server's create bounds for invite links
// (`INVITE_LINK_CREATE_MAX_EXPIRY_HOURS` / `INVITE_LINK_CREATE_MAX_USES`):
// outside 1..8760 hours or 1..10000 uses is a 400, never a silent clamp.
function validInviteLinkOptions(expiresInHours: unknown, maxUses: unknown): boolean {
  if (expiresInHours !== undefined) {
    if (
      typeof expiresInHours !== 'number' ||
      !Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > 8760
    ) {
      return false;
    }
  }
  if (maxUses !== undefined) {
    if (
      typeof maxUses !== 'number' ||
      !Number.isInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > 10000
    ) {
      return false;
    }
  }
  return true;
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
        // T-0124: the mock channel rides the group entry with its kind,
        // subscriber count and blurb, like the real server.
        ...(chat.chatKind === 'channel'
          ? {
              chatKind: 'channel',
              subscriberCount: chat.subscriberCount ?? chat.memberCount ?? 0,
              description: chat.description ?? null,
            }
          : {}),
        // T-0164: visibility + handle ride the entry (the web paints the
        // PUBLIC label from them); null handle while private.
        visibility: detail?.visibility ?? 'private',
        handle: detail?.handle ?? null,
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
    jid: `${person.id}@zilar.test`,
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
  const segments = pathParts(path);

  // T-0107: tools and routines in memory. The mock routes live in
  // `toolRoutes` above; an answered path returns here.
  const toolAnswer = toolRoutes(head ?? '', first, second, segments, method, init);
  if (toolAnswer !== undefined) {
    return toolAnswer;
  }

  if (head === 'me') {
    if (method === 'GET' && first === undefined) return jsonResponse(state.me);
    if (method === 'PATCH' && first === undefined) {
      const body = readJsonBody(init);
      if (typeof body.name === 'string') {
        state.me = { ...state.me, name: body.name };
      }
      return jsonResponse(state.me);
    }
    // T-0163: claiming a handle in memory for the page load. `taken_user`
    // is always taken; anything valid-shaped and non-reserved is free.
    // `reserved` maps to `handle_reserved` like the server.
    if (method === 'PUT' && first === 'handle') {
      const body = readJsonBody(init);
      const raw = typeof body.handle === 'string' ? body.handle.trim() : '';
      const checked = mockCheckHandle(raw);
      if (!checked.available) {
        const code =
          checked.reason === 'invalid'
            ? 'handle_invalid'
            : checked.reason === 'reserved'
              ? 'handle_reserved'
              : 'handle_taken';
        return jsonResponse({ error: { code, message: 'That username is not available' } }, 409);
      }
      state.me = { ...state.me, handle: raw };
      return jsonResponse({ handle: raw });
    }
    return notImplemented();
  }

  // T-0163: exact handle lookup, in memory. `taken_user` resolves to Ana
  // (the handle the check endpoint reports as taken); every other
  // valid-shaped, non-reserved handle resolves to a synthetic stranger, so
  // the Add-contact dialog can demo the full card. Reserved words and bad
  // shapes answer the same 404 as unknown handles (no enumeration).
  if (head === 'users' && first === 'by-handle' && second !== undefined && method === 'GET') {
    const raw = decodeURIComponent(second);
    const profile = mockHandleProfile(raw);
    if (profile === null) {
      return jsonResponse(
        { error: { code: 'not_found', message: 'No user with that username' } },
        404,
      );
    }
    return jsonResponse(profile);
  }

  // T-0163: contact requests in memory for the page load: create (POST),
  // list (GET), accept/decline (POST), cancel (DELETE). Accepting links the
  // pair in the in-memory contact sense (no-op here — the mock contact list
  // is static) and flips the status, idempotently.
  if (head === 'contact-requests' && method === 'POST' && first === undefined) {
    return createMockContactRequest(init);
  }

  if (head === 'contact-requests' && method === 'GET' && first === undefined) {
    return jsonResponse(mockContactRequestList());
  }

  if (
    head === 'contact-requests' &&
    second === 'accept' &&
    method === 'POST' &&
    first !== undefined
  ) {
    return decideMockContactRequest(decodeURIComponent(first), 'accepted');
  }

  if (
    head === 'contact-requests' &&
    second === 'decline' &&
    method === 'POST' &&
    first !== undefined
  ) {
    return decideMockContactRequest(decodeURIComponent(first), 'declined');
  }

  if (head === 'contact-requests' && second === undefined && method === 'DELETE') {
    return decideMockContactRequest(decodeURIComponent(first ?? ''), 'cancelled');
  }

  // T-0235: blocks in memory. Unknown users 404; blocking a known user is
  // idempotent and answers `{ blocked: true }`.
  if (head === 'blocks' && first !== undefined && second === undefined && method === 'PUT') {
    const userId = decodeURIComponent(first);
    const known =
      userId === currentUserId ||
      Object.values(PEOPLE).some((entry) => entry.id === userId) ||
      userId.startsWith('u-handle-');
    if (!known) {
      return jsonResponse({ error: { code: 'not_found', message: 'No user with that id' } }, 404);
    }
    if (!state.blockedUsers.some((entry) => entry.userId === userId)) {
      state.blockedUsers.push({ userId, blockedAt: new Date().toISOString() });
    }
    return jsonResponse({ blocked: true });
  }

  if (head === 'blocks' && first !== undefined && second === undefined && method === 'DELETE') {
    const userId = decodeURIComponent(first);
    state.blockedUsers = state.blockedUsers.filter((entry) => entry.userId !== userId);
    return jsonResponse({ blocked: false });
  }

  if (head === 'blocks' && first === undefined && method === 'GET') {
    return jsonResponse({ blocked: mockBlockList() });
  }

  // T-0163: live handle availability, in memory for the page load.
  // `taken-user` is always taken; anything valid-shaped and non-reserved is
  // free. T-0164: `kind=group` also reports the `@acme` handle as taken.
  if (head === 'handles' && first === 'check' && method === 'GET') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const raw = (params.get('handle') ?? '').trim();
    if (params.get('kind') === 'group' && raw.toLowerCase() === 'acme') {
      return jsonResponse({ available: false, reason: 'taken' });
    }
    return jsonResponse(mockCheckHandle(raw));
  }

  if (head === 'chats' && method === 'GET') {
    return jsonResponse({ chats: chatEntries() });
  }

  // T-0120: mock mode serves the two built-in demo packs (relative file
  // URLs) as the panel list and as discover results, so the panel has
  // content. Demo stickers send through the same validation as real ones.
  // T-0121: packs created in the page live in the same list; the panel shows
  // the added packs in order.
  if (head === 'sticker-packs' && first === undefined && method === 'GET') {
    const panel = state.stickerPanel
      .map((id) => state.stickerPacks.find((pack) => pack.id === id))
      .filter((pack): pack is MockStickerPack => pack !== undefined);
    return jsonResponse({ packs: panel });
  }

  if (head === 'sticker-packs' && first === undefined && method === 'POST') {
    return createMockStickerPack(init);
  }

  if (head === 'sticker-packs' && first === 'discover' && method === 'GET') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const query = (params.get('q') ?? '').trim().toLowerCase();
    const packs = state.stickerPacks.filter(
      (pack) =>
        pack.visibility === 'server' && (query === '' || pack.title.toLowerCase().includes(query)),
    );
    return jsonResponse({ packs, next: null });
  }

  if (head === 'sticker-packs' && first !== undefined && first !== 'discover') {
    const packId = decodeURIComponent(first);
    if (second === undefined && method === 'PATCH') {
      return patchMockStickerPack(packId, init);
    }
    if (second === undefined && method === 'DELETE') {
      return deleteMockStickerPack(packId);
    }
    if (second === 'stickers' && segments[3] === undefined && method === 'POST') {
      return uploadMockSticker(packId, init);
    }
    if (second === 'stickers' && segments[3] !== undefined && method === 'DELETE') {
      return deleteMockSticker(packId, decodeURIComponent(segments[3]!));
    }
  }

  // T-0121: atomic panel reorder comes before the add-pack branch: both
  // are `PUT /sticker-panel*`, and the bare path (first === undefined) is
  // the reorder. The order must be exactly the current panel (a
  // permutation); anything else is a 400 like the real server.
  if (head === 'sticker-panel' && first === undefined && method === 'PUT') {
    // A trailing slash is no route on the real server (404), not the
    // reorder and not a silent `{ ok: true }`.
    const rawPath = path.includes('?') ? path.slice(0, path.indexOf('?')) : path;
    if (rawPath.endsWith('/')) {
      return notFound('Sticker pack not found');
    }
    const body = readJsonBody(init);
    const order = Array.isArray(body.order)
      ? body.order.filter((id): id is string => typeof id === 'string')
      : undefined;
    if (
      order === undefined ||
      order.length !== state.stickerPanel.length ||
      !order.every((id) => state.stickerPanel.includes(id)) ||
      new Set(order).size !== order.length
    ) {
      return invalidRequest('order must list every panel pack exactly once');
    }
    state.stickerPanel = order;
    return jsonResponse({ ok: true });
  }

  // T-0120: the demo sticker bytes. The packs carry relative file URLs, so
  // the browser loads the generated SVG art from here — never a `data:`
  // URL, and never a peer-supplied address. Unknown ids 404 like the
  // server's unguessable-id route.
  if (head === 'stickers' && second === 'file' && method === 'GET') {
    const art = first === undefined ? undefined : mockDemoStickerArt(first);
    if (art === undefined) {
      return notFound('Sticker not found');
    }
    const prefix = 'data:image/svg+xml,';
    const svg = art.startsWith(prefix) ? decodeURIComponent(art.slice(prefix.length)) : art;
    return new Response(svg, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
  }

  if (head === 'sticker-panel' && second === undefined && method === 'PUT') {
    // An empty id (bare path with a non-reorder body, or a trailing slash)
    // is no route on the real server: 404 instead of a silent `{ ok: true }`.
    if (first === undefined || first === '') {
      return notFound('Sticker pack not found');
    }
    const packId = decodeURIComponent(first);
    if (
      state.stickerPacks.some((pack) => pack.id === packId) &&
      !state.stickerPanel.includes(packId)
    ) {
      // The real server caps the panel at 200 so the reorder permutation
      // stays satisfiable.
      if (state.stickerPanel.length >= 200) {
        return jsonResponse(
          { error: { code: 'panel_full', message: 'A panel holds at most 200 packs' } },
          400,
        );
      }
      state.stickerPanel = [...state.stickerPanel, packId];
    }
    return jsonResponse({ ok: true });
  }

  if (head === 'sticker-panel' && second === undefined && method === 'DELETE') {
    const packId = decodeURIComponent(first ?? '');
    state.stickerPanel = state.stickerPanel.filter((id) => id !== packId);
    return jsonResponse({ ok: true });
  }

  // T-0121: favorites. PUT bodies carry `{ sticker_id }`; DELETE takes it as
  // a query param, like the real server.
  if (head === 'sticker-favorites' && method === 'GET') {
    return jsonResponse({ favorites: favoriteRows() });
  }

  if (head === 'sticker-favorites' && method === 'PUT') {
    const body = readJsonBody(init);
    const stickerId = typeof body.sticker_id === 'string' ? body.sticker_id : '';
    const sticker = findMockSticker(stickerId);
    if (sticker === undefined) {
      return notFound('Sticker not found');
    }
    if (!state.stickerFavorites.includes(stickerId)) {
      if (state.stickerFavorites.length >= 200) {
        return jsonResponse(
          { error: { code: 'favorites_full', message: 'A user has at most 200 favorites' } },
          400,
        );
      }
      state.stickerFavorites = [...state.stickerFavorites, stickerId];
    }
    return jsonResponse(sticker);
  }

  if (head === 'sticker-favorites' && method === 'DELETE') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const stickerId = params.get('sticker_id') ?? '';
    state.stickerFavorites = state.stickerFavorites.filter((id) => id !== stickerId);
    return jsonResponse({ ok: true });
  }

  // T-0123: the fake Telegram import. A pack of generated stickers is
  // created (or reused by `importedFrom`) from the input: the first demo
  // pack's art is copied in as the pack content, capped like the server.
  // `__mock_unavailable` simulates the server's 501 (feature off);
  // `__mock_partial` reports `partial: true` like an exhausted budget.
  if (
    head === 'sticker-packs' &&
    first === 'import' &&
    second === 'telegram' &&
    method === 'POST'
  ) {
    return importMockTelegramPack(init);
  }

  // T-0122: mock GIF search serves the generated placeholders (no server, no
  // provider). `q` filters by title; `pos` paginates with the same shape as
  // the real routes.
  if ((head === 'gifs' && first === 'search') || (head === 'gifs' && first === 'trending')) {
    if (method !== 'GET') {
      return notImplemented();
    }
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const pos = Number(params.get('pos') ?? '0');
    const start = Number.isInteger(pos) && pos > 0 ? pos : 0;
    const all = mockGifItems().filter((item) => q === '' || item.title.toLowerCase().includes(q));
    const slice = all.slice(start, start + 25);
    const next = start + 25 < all.length ? String(start + 25) : undefined;
    return jsonResponse({
      items: slice,
      ...(next === undefined ? {} : { nextPos: next }),
    });
  }

  // T-0113: in-memory chat prefs. The mock has no access model, so any JID
  // can carry a row; a write back at all defaults deletes the row.
  if (head === 'chat-prefs' && first === undefined && method === 'GET') {
    return jsonResponse({ prefs: state.chatPrefs });
  }

  // T-0461: the personal background default, held in memory and written by the
  // picker (T-0462). All null means unset, so chats fall back to the slate grid.
  if (head === 'chat-background' && first === undefined && method === 'GET') {
    return jsonResponse({ defaultBackground: state.backgroundDefault });
  }

  if (head === 'chat-prefs' && first !== undefined && second === undefined && method === 'PUT') {
    const chatJid = decodeURIComponent(first);
    const body = readJsonBody(init);
    const allowed = new Set([
      'mutedUntil',
      'archived',
      'pinned',
      'backgroundPreset',
      'backgroundImageId',
      'backgroundDim',
    ]);
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
      ('pinned' in body && typeof body.pinned !== 'boolean') ||
      ('backgroundPreset' in body &&
        body.backgroundPreset !== null &&
        typeof body.backgroundPreset !== 'string') ||
      ('backgroundImageId' in body &&
        body.backgroundImageId !== null &&
        typeof body.backgroundImageId !== 'string') ||
      ('backgroundDim' in body &&
        body.backgroundDim !== null &&
        typeof body.backgroundDim !== 'number')
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
    const backgroundPreset = !('backgroundPreset' in body)
      ? (existing?.backgroundPreset ?? null)
      : (body.backgroundPreset as string | null);
    const backgroundImageId = !('backgroundImageId' in body)
      ? (existing?.backgroundImageId ?? null)
      : (body.backgroundImageId as string | null);
    const backgroundDim = !('backgroundDim' in body)
      ? (existing?.backgroundDim ?? null)
      : (body.backgroundDim as number | null);
    // Mirror the server: after merging with the existing row, a preset and an
    // image may not both be set.
    if (backgroundPreset !== null && backgroundImageId !== null) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Set a preset or an image, not both' } },
        400,
      );
    }
    if (
      mutedUntil === null &&
      archived === false &&
      pinnedAt === null &&
      backgroundPreset === null &&
      backgroundImageId === null &&
      backgroundDim === null
    ) {
      state.chatPrefs = state.chatPrefs.filter((pref) => pref.chatJid.toLowerCase() !== key);
      return jsonResponse({ prefs: null });
    }
    const row: MockChatPref = {
      chatJid,
      mutedUntil,
      archived,
      pinnedAt,
      updatedAt: new Date().toISOString(),
      backgroundPreset,
      backgroundImageId,
      backgroundDim,
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

  // T-0462: the personal background default write. Mirrors the server's
  // field rule: a preset and an image together are rejected.
  if (
    head === 'chat-background' &&
    first === undefined &&
    second === undefined &&
    method === 'PUT'
  ) {
    const body = readJsonBody(init);
    const allowed = new Set(['backgroundPreset', 'backgroundImageId', 'backgroundDim']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: `Unknown field: ${key}` } },
          400,
        );
      }
    }
    if (
      ('backgroundPreset' in body &&
        body.backgroundPreset !== null &&
        typeof body.backgroundPreset !== 'string') ||
      ('backgroundImageId' in body &&
        body.backgroundImageId !== null &&
        typeof body.backgroundImageId !== 'string') ||
      ('backgroundDim' in body &&
        body.backgroundDim !== null &&
        typeof body.backgroundDim !== 'number')
    ) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Invalid background body' } },
        400,
      );
    }
    const backgroundPreset =
      'backgroundPreset' in body ? (body.backgroundPreset as string | null) : null;
    const backgroundImageId =
      'backgroundImageId' in body ? (body.backgroundImageId as string | null) : null;
    const backgroundDim = 'backgroundDim' in body ? (body.backgroundDim as number | null) : null;
    if (backgroundPreset !== null && backgroundImageId !== null) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Set a preset or an image, not both' } },
        400,
      );
    }
    state.backgroundDefault = { backgroundPreset, backgroundImageId, backgroundDim };
    return jsonResponse({ defaultBackground: state.backgroundDefault });
  }

  // T-0237: in-memory chat folders, seeded on first GET with Personal and
  // AIs like the server. Validation is deliberately light here (the client
  // only reads); writes mirror the server's status codes and error codes.
  if (head === 'chat-folders' && first === undefined && second === undefined) {
    if (method === 'GET') {
      if (state.chatFolders === undefined) {
        state.chatFolders = seedChatFolders();
      }
      return jsonResponse({ folders: state.chatFolders });
    }
    if (method === 'POST') {
      if (state.chatFolders === undefined) {
        state.chatFolders = seedChatFolders();
      }
      if (state.chatFolders.length >= 20) {
        return jsonResponse({ error: { code: 'folder_limit', message: 'Too many folders' } }, 409);
      }
      const body = readJsonBody(init);
      const folder: MockChatFolder = {
        id: `mock-folder-${state.chatFolders.length + 1}-${Date.now()}`,
        name: typeof body.name === 'string' ? body.name : 'Folder',
        icon: typeof body.icon === 'string' ? body.icon : 'folder',
        position: state.chatFolders.length,
        includeTypes: Array.isArray(body.includeTypes) ? (body.includeTypes as string[]) : [],
        includeChats: Array.isArray(body.includeChats) ? (body.includeChats as string[]) : [],
        excludeChats: Array.isArray(body.excludeChats) ? (body.excludeChats as string[]) : [],
        excludeMuted: body.excludeMuted === true,
        excludeRead: body.excludeRead === true,
      };
      state.chatFolders = [...state.chatFolders, folder];
      return jsonResponse({ folder }, 201);
    }
  }

  if (head === 'chat-folders' && first === 'order' && second === undefined && method === 'PUT') {
    if (state.chatFolders === undefined) {
      state.chatFolders = seedChatFolders();
    }
    const body = readJsonBody(init);
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]) : undefined;
    const currentIds = new Set(state.chatFolders.map((folder) => folder.id));
    if (
      ids === undefined ||
      ids.length !== state.chatFolders.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !currentIds.has(id))
    ) {
      return jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: 'Folder order must list every folder exactly once',
          },
        },
        400,
      );
    }
    const byId = new Map(state.chatFolders.map((folder) => [folder.id, folder]));
    state.chatFolders = (ids as string[]).map((id, position) => ({
      ...(byId.get(id) as MockChatFolder),
      position,
    }));
    return jsonResponse({ folders: state.chatFolders });
  }

  if (head === 'chat-folders' && first !== undefined && second === undefined && first !== 'order') {
    if (state.chatFolders === undefined) {
      state.chatFolders = seedChatFolders();
    }
    const id = decodeURIComponent(first);
    const existing = state.chatFolders.find((folder) => folder.id === id);
    if (existing === undefined) {
      return notFound('Folder not found');
    }
    if (method === 'PATCH') {
      const body = readJsonBody(init);
      const updated: MockChatFolder = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.icon === 'string' ? { icon: body.icon } : {}),
        ...(Array.isArray(body.includeTypes)
          ? { includeTypes: body.includeTypes as string[] }
          : {}),
        ...(Array.isArray(body.includeChats)
          ? { includeChats: body.includeChats as string[] }
          : {}),
        ...(Array.isArray(body.excludeChats)
          ? { excludeChats: body.excludeChats as string[] }
          : {}),
        ...(typeof body.excludeMuted === 'boolean' ? { excludeMuted: body.excludeMuted } : {}),
        ...(typeof body.excludeRead === 'boolean' ? { excludeRead: body.excludeRead } : {}),
      };
      state.chatFolders = state.chatFolders.map((folder) => (folder.id === id ? updated : folder));
      return jsonResponse({ folder: updated });
    }
    if (method === 'DELETE') {
      state.chatFolders = state.chatFolders
        .filter((folder) => folder.id !== id)
        .map((folder, position) => ({ ...folder, position }));
      return jsonResponse({ deleted: true });
    }
  }

  // T-0119: in-memory push devices. The mock has one user and no XMPP
  // session, so subscribing only stores the row and returns the enable pair.
  if (head === 'push' && first === 'config' && method === 'GET') {
    return jsonResponse({ vapidPublicKey: 'mock-vapid-public-key', pushJid: 'push.mock.test' });
  }

  if (head === 'push' && first === 'subscriptions' && second === undefined) {
    if (method === 'GET') {
      return jsonResponse({ devices: state.pushDevices });
    }
    if (method === 'POST') {
      const body = readJsonBody(init);
      if (
        typeof body.endpoint !== 'string' ||
        body.endpoint === '' ||
        typeof body.keys !== 'object' ||
        body.keys === null
      ) {
        return jsonResponse(
          { error: { code: 'invalid_subscription', message: 'The push subscription is invalid' } },
          400,
        );
      }
      const id = `mock-push-device-${state.nextPushDeviceSequence}`;
      state.nextPushDeviceSequence += 1;
      const node = `mock-node-${id}`;
      const userAgent = typeof body.userAgent === 'string' ? body.userAgent : null;
      state.pushDevices = state.pushDevices.filter((device) => device.id !== id);
      state.pushDevices.push({
        id,
        userAgent,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        inactive: false,
      });
      return jsonResponse({ id, node, jid: 'push.mock.test' });
    }
  }

  if (head === 'push' && first === 'subscriptions' && second !== undefined && method === 'DELETE') {
    const id = decodeURIComponent(second);
    const existing = state.pushDevices.some((device) => device.id === id);
    if (!existing) {
      return notFound('Push device not found');
    }
    state.pushDevices = state.pushDevices.filter((device) => device.id !== id);
    return jsonResponse({ removed: true });
  }

  if (head === 'push' && first === 'settings' && method === 'GET') {
    return jsonResponse({ showPreviews: state.pushShowPreviews });
  }

  if (head === 'push' && first === 'settings' && method === 'PUT') {
    const body = readJsonBody(init);
    if (typeof body.showPreviews !== 'boolean') {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'showPreviews must be a boolean' } },
        400,
      );
    }
    state.pushShowPreviews = body.showPreviews;
    return jsonResponse({ showPreviews: state.pushShowPreviews });
  }

  if (head === 'push' && first === 'test' && method === 'POST') {
    const body = readJsonBody(init);
    const target =
      typeof body.subscriptionId === 'string'
        ? state.pushDevices.find((device) => device.id === body.subscriptionId)
        : undefined;
    if (target === undefined) {
      return notFound('Push device not found');
    }
    return jsonResponse({ sent: true });
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

  // T-0443: in-memory AI memory, keyed by `${chat}|${ai}` and seeded on the
  // first read. The mock has one user (the AI owner), so `canChange` is true.
  if (head === 'ai-memory') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const key = `${params.get('chat') ?? ''}|${params.get('ai') ?? ''}`;
    const memory = state.aiMemory.get(key) ?? seedAiMemory();

    if (first === undefined && method === 'GET') {
      state.aiMemory.set(key, memory);
      return jsonResponse({ ...memory, canChange: true });
    }
    if (first === 'facts' && second !== undefined && method === 'DELETE') {
      const factId = decodeURIComponent(second);
      if (!memory.facts.some((fact) => fact.id === factId)) {
        return notFound('Fact not found');
      }
      state.aiMemory.set(key, {
        ...memory,
        facts: memory.facts.filter((fact) => fact.id !== factId),
      });
      return jsonResponse({ ok: true });
    }
    if (first === 'clear' && method === 'POST') {
      const body = readJsonBody(init);
      const chat = typeof body.chat === 'string' ? body.chat : '';
      const ai = typeof body.ai === 'string' ? body.ai : '';
      state.aiMemory.set(`${chat}|${ai}`, { facts: [], lines: [] });
      return jsonResponse({ ok: true });
    }
    return notImplemented();
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

  // T-0115: group invite links in memory for the page load. The mock is the
  // group owner everywhere it matters, so create/list/revoke always succeed
  // for known groups. Tokens are random hex shown once at creation; the list
  // carries hints, never tokens — like the real server. `pathParts` drops
  // the link id, so the revoke branch matches on raw segments. Create
  // enforces the server's upper bounds (400 `invalid_request` above 8760
  // hours or 10000 uses); join answers 409 `group_full` and 429
  // `rate_limited` like the server, with a per-link attempt window the
  // tests reset via `resetMockApi`.
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
      // Like the server's create schema (400 `invalid_request` outside
      // 1..8760 hours or 1..10000 uses, never a silent clamp).
      if (!validInviteLinkOptions(body.expiresInHours, body.maxUses)) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'Invalid invite link options' } },
          400,
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
  // group (so it previews as a member, with the group id); unknown tokens
  // 404 `invalid_link`. The preview carries `groupId` only for members,
  // like the real server. Join answers 409 `group_full` at the 50-member
  // cap (without consuming a use) and 429 `rate_limited` past 20 attempts
  // per link per page load, so the join page's `full` and rate-limited
  // states are reachable in mock mode.
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
        ...(alreadyMember ? { groupId: link.groupId } : {}),
        // T-0124: the channel kind, so mock-mode JoinPage reads "Join
        // channel" like the real preview.
        ...(detail.kind === 'channel' ? { kind: 'channel' as const } : {}),
      });
    }
    if (method === 'POST') {
      // Like the server's per-user join limiter (20 attempts per hour):
      // past the budget the link answers 429 `rate_limited`. The mock
      // counts per link per page load; the count resets with `resetMockApi`.
      const attempts = (state.joinAttempts.get(link.id) ?? 0) + 1;
      state.joinAttempts.set(link.id, attempts);
      if (attempts > 20) {
        return jsonResponse(
          { error: { code: 'rate_limited', message: 'Too many join attempts, try again later' } },
          429,
        );
      }
      // Like the server's add-member cap check (`MAX_GROUP_MEMBERS`, 50):
      // a group that already reached the cap answers 409 `group_full`
      // without consuming a use — unless the caller is already a member
      // (the server's fast `alreadyMember` path returns before the cap).
      const memberTotal = detail.members.length;
      if (memberTotal >= 50 && !alreadyMember) {
        return jsonResponse({ error: { code: 'group_full', message: 'This group is full' } }, 409);
      }
      if (!alreadyMember) {
        link.uses += 1;
      }
      return jsonResponse({ groupId: link.groupId, alreadyMember });
    }
    return notImplemented();
  }

  // T-0164: the Explore directory in memory for the page load. Only mock
  // groups marked public (the Acme channel, plus any group flipped public
  // through PATCH) appear — never users, never private groups. `q` matches
  // handle or title prefixes (case-insensitive, at least 2 characters);
  // empty lists newest first; `kind` filters; 20 per page with an opaque
  // base64url index cursor the mock parses back (like the server's cursor,
  // only simpler — an offset into the filtered rows).
  if (head === 'directory' && method === 'GET') {
    const params = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
    const q = (params.get('q') ?? '').trim();
    const kind = params.get('kind');
    if (q !== '' && q.length < 2) {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Search needs at least 2 characters' } },
        400,
      );
    }
    if (kind !== null && kind !== 'group' && kind !== 'channel') {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'Invalid kind filter' } },
        400,
      );
    }
    const lower = q.toLowerCase();
    const rows = (
      Object.entries(mockGroupDetails) as Array<[string, (typeof mockGroupDetails)[string]]>
    )
      .filter(
        ([, detail]) =>
          detail.visibility === 'public' && detail.handle !== undefined && detail.handle !== null,
      )
      .filter(([, detail]) => kind === null || detail.kind === kind)
      .filter(
        ([, detail]) =>
          q === '' ||
          (detail.handle !== undefined &&
            detail.handle !== null &&
            detail.handle.toLowerCase().startsWith(lower)) ||
          detail.title.toLowerCase().startsWith(lower),
      )
      .map(([, detail]) => ({
        id: detail.id,
        kind: detail.kind ?? 'group',
        title: detail.title,
        handle: detail.handle ?? '',
        description: detail.description ?? null,
        memberCount: detail.members.length,
        joined: detail.members.some((member) => member.userId === currentUserId),
      }))
      .reverse();
    const start = decodeMockDirectoryCursor(params.get('cursor'));
    if (start === null) {
      return jsonResponse({ error: { code: 'invalid_request', message: 'Invalid cursor' } }, 400);
    }
    const page = rows.slice(start, start + 20);
    return jsonResponse({
      entries: page,
      next: start + 20 < rows.length ? encodeMockDirectoryCursor(start + 20) : null,
    });
  }

  // T-0164: the mock directory's opaque page cursor: a base64url offset
  // into the filtered rows. Absent reads as the first page; anything that
  // does not decode to a non-negative integer is a 400, like the server's
  // invalid cursor.
  function encodeMockDirectoryCursor(start: number): string {
    return btoa(`dir_${start}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeMockDirectoryCursor(raw: string | null): number | null {
    if (raw === null || raw === '') {
      return 0;
    }
    let decoded: string;
    try {
      const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
      decoded = atob(padded);
    } catch {
      return null;
    }
    const match = /^dir_(\d+)$/.exec(decoded);
    if (match === null) {
      return null;
    }
    const start = Number(match[1]);
    return Number.isSafeInteger(start) ? start : null;
  }

  // T-0164: exact public-group lookup by `@handle` in memory. Users,
  // private groups and unknown handles answer the same 404.
  if (head === 'groups' && first === 'by-handle' && second !== undefined && method === 'GET') {
    const raw = decodeURIComponent(second).trim().toLowerCase();
    const detail = Object.values(mockGroupDetails).find(
      (item) =>
        item.visibility === 'public' &&
        item.handle !== undefined &&
        item.handle !== null &&
        item.handle.toLowerCase() === raw,
    );
    if (detail === undefined || detail.handle === undefined || detail.handle === null) {
      return jsonResponse({ error: { code: 'not_found', message: 'No public group' } }, 404);
    }
    return jsonResponse({
      id: detail.id,
      kind: detail.kind ?? 'group',
      title: detail.title,
      handle: detail.handle,
      description: detail.description ?? null,
      memberCount: detail.members.length,
      joined: detail.members.some((member) => member.userId === currentUserId),
    });
  }

  // T-0164: open join of a public mock group. Private and unknown groups
  // answer the same 404; joining twice reports `alreadyMember: true`.
  if (head === 'groups' && second === 'join' && method === 'POST') {
    const groupId = decodeURIComponent(first ?? '');
    const detail = Object.values(mockGroupDetails).find((item) => item.id === groupId);
    if (detail === undefined || detail.visibility !== 'public') {
      return jsonResponse({ error: { code: 'not_found', message: 'Group not found' } }, 404);
    }
    if (detail.members.some((member) => member.userId === currentUserId)) {
      return jsonResponse({ groupId: detail.id, alreadyMember: true });
    }
    detail.members = [
      ...detail.members,
      { userId: currentUserId, name: mockPersonName(currentUserId), role: 'member', roles: [] },
    ];
    return jsonResponse({ groupId: detail.id, alreadyMember: false });
  }

  // T-0124: creating groups and channels in mock mode. The row lands in
  // `mockGroupDetails` under a fresh chat id; the mock user owns it.
  if (head === 'groups' && first === undefined && method === 'POST') {
    const body = readJsonBody(init);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
    if (title === '') {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'title must not be empty' } },
        400,
      );
    }
    const kind = body.kind === 'channel' ? 'channel' : 'group';
    const description =
      typeof body.description === 'string' && body.description.trim() !== ''
        ? body.description.trim().slice(0, 300)
        : null;
    const memberIds = Array.isArray(body.memberIds)
      ? [...new Set(body.memberIds.filter((item): item is string => typeof item === 'string'))]
      : [];
    const groupId = `g-mock-${state.nextTopicSequence}`;
    const chatId = `c-mock-${state.nextTopicSequence}`;
    state.nextTopicSequence += 1;
    const created = {
      id: groupId,
      title,
      createdBy: currentUserId,
      membersCanCreateTopics: false,
      ...(kind === 'channel' ? { kind: 'channel' as const, description } : {}),
      members: [
        {
          userId: currentUserId,
          name: mockPersonName(currentUserId),
          role: 'owner' as const,
          roles: [],
        },
        ...memberIds
          .filter((userId) => userId !== currentUserId)
          .map((userId) => ({
            userId,
            name: mockPersonName(userId),
            role: 'member' as const,
            roles: [],
          })),
      ],
      ais: [],
    };
    mockGroupDetails[chatId] = created;
    return jsonResponse(created, 201);
  }

  // T-0111: the group's topic settings switch. The mock has one user,
  // the group owner, so PATCH always succeeds for the Dev team group.
  // T-0164: the same route carries `visibility` + `handle` (owner only —
  // the mock user owns every mock group). Going public needs a
  // valid-shaped, non-reserved, free handle (`taken_user` and `acme` read
  // as taken, like the handle endpoints); going private clears it.
  if (head === 'groups' && second === undefined && method === 'PATCH') {
    const groupId = decodeURIComponent(first ?? '');
    const detail = Object.values(mockGroupDetails).find((item) => item.id === groupId);
    if (detail === undefined) {
      return notFound('Group not found');
    }
    const body = readJsonBody(init);
    let updated = detail;
    if (typeof body.membersCanCreateTopics === 'boolean') {
      updated = { ...updated, membersCanCreateTopics: body.membersCanCreateTopics };
    }
    if (body.visibility === 'private' || body.visibility === 'public') {
      if (body.visibility === 'private') {
        updated = { ...updated, visibility: 'private', handle: null };
      } else {
        const raw = typeof body.handle === 'string' ? body.handle.trim() : '';
        const checked = mockCheckHandle(raw);
        if (!checked.available) {
          const code =
            checked.reason === 'invalid'
              ? 'handle_invalid'
              : checked.reason === 'reserved'
                ? 'handle_reserved'
                : 'handle_taken';
          return jsonResponse(
            { error: { code, message: 'That handle is not available' } },
            code === 'handle_invalid' ? 400 : 409,
          );
        }
        if (raw.toLowerCase() === 'acme' && detail.id !== 'g-acme') {
          return jsonResponse(
            { error: { code: 'handle_taken', message: 'That handle is taken' } },
            409,
          );
        }
        updated = { ...updated, visibility: 'public', handle: raw };
      }
    }
    if (updated !== detail) {
      for (const [chatId, entry] of Object.entries(mockGroupDetails)) {
        if (entry.id === groupId) {
          mockGroupDetails[chatId] = updated;
        }
      }
    }
    if (typeof body.membersCanCreateTopics === 'boolean' && updated === detail) {
      return jsonResponse(detail);
    }
    return jsonResponse(updated);
  }

  // T-0124: channel member routes in mock mode (the mock user owns every
  // mock group). `GET /groups/:id/members` gives subscribers the admins
  // slice only (who posts is public); the role route promotes/demotes
  // against the in-memory detail; DELETE removes (leave). `g-devteam`
  // keeps its group behaviour through the same routes.
  if (head === 'groups' && second === 'members') {
    const segments =
      path
        .split('?')[0]
        ?.split('/')
        .filter((part) => part !== '') ?? [];
    const groupId = decodeURIComponent(first ?? '');
    const detail = Object.values(mockGroupDetails).find((item) => item.id === groupId);
    if (detail === undefined) {
      return notFound('Group not found');
    }
    const viewer = detail.members.find((member) => member.userId === currentUserId);
    if (viewer === undefined) {
      return notFound('Group not found');
    }
    const isManager = viewer.role === 'owner' || viewer.role === 'admin';
    // `/groups/:id/members` — the audience list for admins, the admins
    // slice for channel subscribers (mirrors `listMembersForViewer`).
    if (segments.length === 3 && method === 'GET') {
      const rows =
        detail.kind === 'channel' && !isManager
          ? detail.members.filter((member) => member.role !== 'member')
          : detail.members;
      const visible = rows.map((member) => ({
        userId: member.userId,
        name: member.name,
        role: member.role,
        roles: member.roles ?? [],
      }));
      return jsonResponse({ members: visible });
    }
    // `/groups/:id/members/:userId/role` — channels only, owner only.
    // Non-owners (and plain groups) 404 like an unknown group, mirroring
    // the server's same-404 rule.
    if (segments.length === 5 && segments[4] === 'role' && method === 'PUT') {
      if (viewer.role !== 'owner' || detail.kind !== 'channel') {
        return notFound('Group not found');
      }
      const userId = decodeURIComponent(segments[3] ?? '');
      const member = detail.members.find((item) => item.userId === userId);
      if (member === undefined) {
        return notFound('That user is not a member');
      }
      const body = readJsonBody(init);
      if (body.role !== 'admin' && body.role !== 'member') {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'role must be admin or member' } },
          400,
        );
      }
      if (member.role === 'owner' || userId === currentUserId) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'The owner cannot change roles' } },
          400,
        );
      }
      if (
        body.role === 'member' &&
        detail.kind === 'channel' &&
        !detail.members.some((item) => item.userId !== userId && item.role === 'admin')
      ) {
        return jsonResponse(
          { error: { code: 'channel_needs_admin', message: 'A channel needs an admin' } },
          409,
        );
      }
      member.role = body.role;
      return jsonResponse(detail);
    }
    // `/groups/:id/members/:userId` — leave (self) or remove (manager).
    // Removing a channel admin refuses with `channel_needs_admin` while
    // they are the last admin, mirroring the server guard (kicking a
    // subscriber always succeeds).
    if (segments.length === 4 && method === 'DELETE') {
      const userId = decodeURIComponent(segments[3] ?? '');
      const target = detail.members.find((item) => item.userId === userId);
      if (target === undefined) {
        return notFound('That user is not a member');
      }
      if (userId !== currentUserId && !isManager) {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
      }
      if (target.role === 'owner') {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'The owner cannot be removed' } },
          400,
        );
      }
      if (
        detail.kind === 'channel' &&
        target.role === 'admin' &&
        userId !== currentUserId &&
        !detail.members.some((item) => item.userId !== userId && item.role === 'admin')
      ) {
        return jsonResponse(
          { error: { code: 'channel_needs_admin', message: 'A channel needs an admin' } },
          409,
        );
      }
      detail.members = detail.members.filter((item) => item.userId !== userId);
      return jsonResponse(detail);
    }
    return notImplemented();
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
        chatJid: `${id}@rooms.zilar.test`,
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
        roleIds: [],
        approverRoleId: null,
      };
      state.topics = [...state.topics, created];
      return jsonResponse(topicToView(created), 201);
    }
    return notImplemented();
  }

  // T-0116: custom group roles. The mock has one user (the group owner), so
  // every write succeeds, like the real server's manager check with the
  // mock's single user. Names stay unique ignoring case; at most 20 roles.
  if (head === 'groups' && second === 'roles') {
    const groupId = decodeURIComponent(first ?? '');
    if (groupId !== 'g-devteam') {
      return notFound('Group not found');
    }
    const segments = pathParts(path);
    const roleId = segments[3];
    if (roleId === undefined) {
      if (method === 'GET') {
        return jsonResponse({ roles: state.groupRoles.map((role) => roleToView(role)) });
      }
      if (method === 'POST') {
        const body = readJsonBody(init);
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 30) : '';
        if (name === '' || hasMockControlCharacters(name)) {
          return jsonResponse(
            { error: { code: 'invalid_request', message: 'name must not be empty' } },
            400,
          );
        }
        if (state.groupRoles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
          return conflict('role_exists', 'A role with that name already exists');
        }
        if (state.groupRoles.length >= 20) {
          return jsonResponse(
            { error: { code: 'invalid_request', message: 'A group has at most 20 roles' } },
            400,
          );
        }
        const created: MockGroupRole = {
          id: `role-mock-${state.nextRoleSequence}`,
          groupId: 'g-devteam',
          name,
          memberIds: [],
        };
        state.nextRoleSequence += 1;
        state.groupRoles = [...state.groupRoles, created];
        return jsonResponse(roleToView(created), 201);
      }
      return notImplemented();
    }
    const role = findRole(roleId);
    if (role === undefined || role.groupId !== groupId) {
      return notFound('Role not found');
    }
    if (segments[4] === undefined) {
      if (method === 'PATCH') {
        const body = readJsonBody(init);
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 30) : '';
        if (name === '' || hasMockControlCharacters(name)) {
          return jsonResponse(
            { error: { code: 'invalid_request', message: 'name must not be empty' } },
            400,
          );
        }
        if (
          state.groupRoles.some(
            (item) => item.id !== role.id && item.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          return conflict('role_exists', 'A role with that name already exists');
        }
        role.name = name;
        return jsonResponse(roleToView(role));
      }
      if (method === 'DELETE') {
        state.groupRoles = state.groupRoles.filter((item) => item.id !== role.id);
        for (const topic of state.topics) {
          topic.roleIds = topic.roleIds.filter((id) => id !== role.id);
          if (topic.approverRoleId === role.id) {
            topic.approverRoleId = null;
          }
        }
        return noContent();
      }
      return notImplemented();
    }
    if (segments[4] === 'members' && method === 'PUT') {
      const body = readJsonBody(init);
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.filter((item): item is string => typeof item === 'string'))]
        : [];
      role.memberIds = userIds;
      return jsonResponse(roleToView(role));
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
      return notFound(MOCK_TOPIC_NOT_FOUND);
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
      // "the topic is gone" without re-checking the row. Removing the last
      // member of a private topic archives it — and the archived answer is
      // the same `Topic not found` 404 the server sends.
      if (!topic.memberIds.includes(userId)) {
        return notFound('That user is not a member of this topic');
      }
      topic.memberIds = topic.memberIds.filter((id) => id !== userId);
      if (topic.memberIds.length === 0 && topic.visibility === 'private') {
        topic.archived = true;
      }
      // T-0146: an archived topic answers like the server — the missing-id
      // 404 — whether or not this DELETE caused the archive. The mock
      // store drops archived rows at once (`withMockTopicRow`) and
      // remembers archived ids, so the row re-check still tells "gone"
      // from "not a member".
      if (topic.archived) {
        return notFound(MOCK_TOPIC_NOT_FOUND);
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
    // T-0116: attach roles and pick the approver role. Only roles of the
    // topic's group count, and only on private topics.
    if (second === 'roles' && method === 'PUT') {
      if (topic.visibility !== 'private' || topic.isGeneral) {
        return jsonResponse(
          { error: { code: 'not_private', message: 'Only private topics have roles' } },
          400,
        );
      }
      const body = readJsonBody(init);
      const roleIds = Array.isArray(body.roleIds)
        ? [...new Set(body.roleIds.filter((item): item is string => typeof item === 'string'))]
        : [];
      const approverRoleId =
        body.approverRoleId === null || body.approverRoleId === undefined
          ? null
          : typeof body.approverRoleId === 'string'
            ? body.approverRoleId
            : undefined;
      if (approverRoleId === undefined) {
        return jsonResponse(
          {
            error: { code: 'invalid_request', message: 'approverRoleId must be a string or null' },
          },
          400,
        );
      }
      if (
        roleIds.some((id) => findRole(id) === undefined) ||
        (approverRoleId !== null && findRole(approverRoleId) === undefined)
      ) {
        return jsonResponse(
          { error: { code: 'invalid_request', message: 'Roles must belong to the topic’s group' } },
          400,
        );
      }
      topic.roleIds = roleIds;
      topic.approverRoleId = approverRoleId;
      return jsonResponse(topicToView(topic));
    }
    if (second === 'tools' && method === 'GET') {
      const topic = findTopic(topicId);
      if (topic === undefined) {
        return notFound(MOCK_TOPIC_NOT_FOUND);
      }
      // T-0107: the topic's tools in memory (was an empty list before).
      return jsonResponse(
        state.tools.filter((tool) => !tool.deleted && tool.topicId === topicId).map(toolListRow),
      );
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

  // T-0170: voice transcripts on demand, in memory for the page load. The
  // mock has an endpoint configured, so the control shows and one tap
  // resolves to a fixed sentence per URL (cached, like the real server).
  if (head === 'voice' && first === 'transcription' && method === 'GET') {
    return jsonResponse({ enabled: true });
  }

  if (head === 'voice' && first === 'transcript' && method === 'POST') {
    const body = readJsonBody(init);
    const url = typeof body.url === 'string' ? body.url : '';
    if (url === '') {
      return jsonResponse(
        { error: { code: 'invalid_request', message: 'url must not be empty' } },
        400,
      );
    }
    return jsonResponse({ text: `Transcript of ${url}` });
  }

  return notImplemented();
}

// T-0117: a small in-memory index over the mock messages — the DM/group
// threads plus every topic thread (T-0133: `mockTopicMessages()` has one
// entry per topic chat id, and General's legacy `c-devteam` thread is
// untouched since topics carry their own chat ids). Case-insensitive
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
  const index = { ...mockMessages, ...mockTopicMessages() };
  for (const [chatId, messages] of Object.entries(index)) {
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
