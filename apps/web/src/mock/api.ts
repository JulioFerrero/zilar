import type { Connection, Machine, Me, PublicAi } from '@/lib/api';
import { RESERVED_HANDLES } from '@/lib/handles';
import { currentUserId, PEOPLE } from './ids';
import { mockDemoStickerPacks } from './helpers';
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
  // T-0464: the caller's uploaded background images, newest first, and the
  // counter behind their ids.
  backgrounds: MockBackground[];
  nextBackgroundSequence: number;
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

// T-0464: one uploaded background image in memory for the page load. The mock
// never stores bytes (the app only shows the returned url), so width and
// height come from the upload defaults below.
interface MockBackground {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
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
    backgrounds: [],
    nextBackgroundSequence: 1,
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
