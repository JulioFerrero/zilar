import {
  createXmppCore,
  type ChatKind,
  type ChatMessage,
  type SendMessageOptions,
  type XmppCore,
  type XmppCoreOptions,
} from '@zilar/xmpp-core';
import type { Payload } from '@zilar/protocol';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
  type FetchLike,
  type LitellmAdminClient,
} from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import {
  ensureAiModel,
  listActiveAisForGateway,
  onAiLifecycle,
  revertPersonaFromChat,
  setPersonaFromChat,
  type ActiveAiForGateway,
  type AiServiceDeps,
} from '../ais/service';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import {
  ais,
  groupAis,
  groupMembers,
  groups,
  llmVirtualKeys,
  topicAis,
  topicMembers,
  topics,
  user,
} from '../db/schema';
import { sharedDraftHub, type DraftHub } from '../drafts/hub';
import { onGroupAi, onTopicAi } from '../groups/events';
import { allowedTopicAiIds } from '../topics/access';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { XmppConfig } from '../xmpp/config';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { issueXmppToken } from '../xmpp/token';
import type { GroupRole } from '../groups/service';
import {
  bareJid,
  buildDmMessages,
  buildGroupMessages,
  displayNameOf,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
  type MemoryContext,
} from './context';
import { TOOL_GUIDE } from './tool-guide';
import { compactMemory } from './memory/compactor';
import { indexMemory, type MemoryScope } from './memory/indexer';
import { looksLikeSecret } from './memory/secrets';
import { addFact, listFacts, recallMemory, renderMemoryBlock, zoomMemory } from './memory/store';
import type { ArchivePool } from '../search/service';
import { getAiUsage, type AiUsage } from '../ais/usage';
import {
  completeChat,
  dailyLimitReply,
  dailyWarningReply,
  mapFailureToReply,
  monthlyWarningReply,
  runDmTurn,
  runGroupTurn,
  type ExecuteToolCall,
  type ToolExecution,
  type ValidToolCall,
} from './reply';
import {
  buildGroupTools,
  buildTools,
  formatPersonaUpdatedLine,
  formatRememberedLine,
  MEMORY_ZOOM_TOOL,
  PERSONA_RESTORED_LINE,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  UPDATE_PERSONA_TOOL,
} from './tools';
import type { ActionGateway, DeniedReason, RequestOutcome } from '../actions/gateway';

export interface GatewayLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AgentGatewayDeps {
  db: ServerDatabase;
  xmpp: XmppConfig;
  adminClient: EjabberdAdminClient;
  /** Absent when LiteLLM is not configured: the gateway stays off. */
  litellm?: LitellmAdminClient;
  /** Absent when the key master key is not configured: the gateway stays off. */
  cipher?: KeyCipher;
  logger: GatewayLogger;
  /** T-0156: counts logger for the tool-turn counts line (rounds, tool
   * calls, ms — ids and counts only, never content). Falls back to
   * `logger` so production keeps the line the T-0106 review deferred. */
  turnLogger?: GatewayLogger;
  litellmBaseUrl?: string;
  /** Only used to redact log lines; never sent anywhere. */
  masterKeyForRedaction?: string;
  createCore?: (options: XmppCoreOptions) => XmppCore;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Draft hub for live reply drafts. Defaults to the shared server hub. */
  drafts?: { hub?: DraftHub };
  /** Optional action gateway. When present, every DM turn also offers the
   * `request_action` tool, and tool calls route through it. Absent = no
   * action tool, no behaviour change for the persona tools. */
  actions?: ActionGateway;
  /** T-0106: whether `TOOLS_ENABLED` is on. The tool guide rides the system
   * prompt only when this is true AND tool/routine adapters are registered
   * for the turn's context. Defaults to false (today's prompts). */
  toolsEnabled?: boolean;
  /** T-0106: how many tool rounds one turn may run. Defaults to 1
   * (today's behaviour, byte for byte). Production passes
   * `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED` is on). */
  toolMaxRounds?: number;
  /** Memory archive. Absent means memory is read but never indexed. */
  archive?: ArchivePool;
}

export interface AgentGatewayConfig {
  enabled: boolean;
  reconcileIntervalMs?: number;
  retryBaseDelayMs?: number;
}

// Safety net: a missed notifier event is picked up at most this late.
export const RECONCILE_INTERVAL_MS = 60_000;

// First reconnect delay after a failed connect; doubles per attempt.
export const RETRY_BASE_DELAY_MS = 5_000;
export const RETRY_MAX_DELAY_MS = 60_000;

// Fresh-token TTL for each AI login. xmpp-core asks `getToken` on every
// (re)connect, so no connection ever runs on a stale token.
const XMPP_TOKEN_TTL_SECONDS = 300;

// Every gateway logs each AI in with the same fixed resource, so ejabberd
// replaces the old session when a new gateway logs in. The replaced gateway
// stands down (see the `replaced` handler): the newest gateway wins.
export const GATEWAY_RESOURCE = 'gateway';

// Privacy and cost rules for groups (T-0054, see the Report): any human
// member may trigger an AI by @mentioning it, and the owner pays under the
// AI's capped virtual key. The AI only sees room messages sent while it is a
// member (plus the MAM history that membership grants). Every log line below
// carries ids only: the AI id, the group id and the message id. Never bodies,
// names or keys.

// Per AI per room: at most this many turns in the sliding window below. The
// rest are dropped with one log line.
export const GROUP_TURNS_PER_WINDOW = 6;
export const GROUP_RATE_WINDOW_MS = 10 * 60_000;

// A live room message carries ~now as its timestamp, while history replayed
// on join carries its original (older) stamp. Anything older than the join
// minus this skew is treated as replayed history and never wakes the AI.
export const GROUP_JOIN_SKEW_MS = 60_000;

interface PendingMessage {
  id: string;
  body: string;
  fromJid: string;
}

interface RoomPendingMessage {
  id: string;
  body: string;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  timestamp: Date;
}

interface RoomSubscription {
  groupId: string;
  /** The topic this room belongs to. Set for every room subscription. */
  topicId: string;
  joinedAtMs: number;
  nick: string;
}

interface AiSession {
  aiId: string;
  aiJid: string;
  core: XmppCore;
  busy: boolean;
  pending: PendingMessage[];
  stopped: boolean;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  unsubs: Array<() => void>;
  /** Rooms the AI currently holds a join for, keyed by bare room JID. */
  rooms: Map<string, RoomSubscription>;
  /** One coalescing queue per room, like the DM queue. */
  roomPending: Map<string, RoomPendingMessage[]>;
  /** Rooms with a turn in flight. */
  roomBusy: Set<string>;
  /** Turn timestamps (ms) per room for the rate limit. */
  roomTurns: Map<string, number[]>;
}

export interface AgentGateway {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** The periodic safety net, exposed so tests can drive it directly. */
  reconcile: () => Promise<void>;
  size: () => number;
  aiIds: () => string[];
  /**
   * Posts a message from the AI's own live XMPP session into the chat the
   * action gateway asked about. Returns `true` when the message went out
   * and `false` (sending nothing) when the AI has no live session, when
   * the AI is unknown, or — for a group — when the AI is not currently
   * subscribed to the room. Used by the action gateway to announce tier-2
   * requests and their outcomes; a stopped AI (kill switch) returns
   * `false`, so nothing is posted.
   */
  postToChat: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
}

function isAiSender(bare: string): boolean {
  return (bare.split('@')[0] ?? '').startsWith('ai-');
}

function retryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

// The model-facing wording for a `denied` outcome. We never echo the
// adapter's reason beyond the stable enum: only `unknown_action`,
// `invalid_args`, `ai_not_active`, and `ai_not_in_group` (T-0090).
function denialReasonForModel(reason: DeniedReason): string {
  switch (reason) {
    case 'unknown_action':
      return 'unknown action';
    case 'invalid_args':
      return 'invalid arguments';
    case 'ai_not_active':
      return 'the AI is not active';
    case 'ai_not_in_group':
      return 'the AI is not in that topic';
  }
}

// Appends an adapter's `modelText` to an executed outcome as a labelled
// untrusted block (T-0105): the model's only way to read a tool's source
// or a test run's output. `undefined` (the adapter returned none) appends
// nothing. Tool output is data, never instructions: the wrapper names it
// as untrusted so the model treats it accordingly.
function formatModelText(modelText: string | undefined): string {
  if (modelText === undefined) {
    return '';
  }
  return `\n\n<untrusted-tool-output>\n${modelText}\n</untrusted-tool-output>`;
}

function toRedactedError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSecrets(error.message, secrets));
    redacted.name = error.name;
    redacted.stack = redactSecrets(error.stack ?? '', secrets);
    return redacted;
  }
  return new Error(redactSecrets(String(error), secrets));
}

async function loadActiveAi(db: ServerDatabase, aiId: string): Promise<ActiveAiForGateway | null> {
  const [row] = await db
    .select({
      id: ais.id,
      jid: ais.jid,
      localpart: ais.localpart,
      owner: ais.owner,
      name: ais.name,
      persona: ais.persona,
    })
    .from(ais)
    .where(and(eq(ais.id, aiId), eq(ais.status, 'active')))
    .limit(1);
  return row ?? null;
}

async function loadOwnerName(db: ServerDatabase, ownerId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, ownerId))
    .limit(1);
  const name = row?.name?.trim() ?? '';
  return name === '' ? 'owner' : name;
}

// Every room an AI belongs to (T-0109): for each `group_ais` row the
// group's General room, plus each non-archived topic where the AI is in
// `topic_ais`. Every subscription carries the topic id (and still the group
// id) so the turn knows which topic it is answering in.
async function listAiRooms(
  db: ServerDatabase,
  aiId: string,
): Promise<Array<{ groupId: string; topicId: string; roomLocalpart: string }>> {
  const groupRows = await db
    .select({ groupId: groupAis.groupId, roomLocalpart: groups.roomLocalpart })
    .from(groupAis)
    .innerJoin(groups, eq(groups.id, groupAis.groupId))
    .where(eq(groupAis.aiId, aiId));
  if (groupRows.length === 0) {
    return [];
  }
  const groupIds = groupRows.map((row) => row.groupId);
  const topicRows = await db
    .select({
      id: topics.id,
      groupId: topics.groupId,
      roomLocalpart: topics.roomLocalpart,
      visibility: topics.visibility,
      isGeneral: topics.isGeneral,
      archivedAt: topics.archivedAt,
    })
    .from(topics)
    .where(inArray(topics.groupId, groupIds));
  const topicAiRows = await db
    .select({ topicId: topicAis.topicId })
    .from(topicAis)
    .where(eq(topicAis.aiId, aiId));
  const inTopic = new Set(topicAiRows.map((row) => row.topicId));
  // The owner's visibility is a live derived rule (see `allowedTopicAiIds`):
  // a private topic counts only while the AI's owner is a topic member. The
  // rows stay, so adding the owner back brings the AI back automatically.
  const allowedByTopic = new Map<string, Set<string>>();
  for (const topic of topicRows) {
    if (!topic.isGeneral && topic.archivedAt === null && inTopic.has(topic.id)) {
      allowedByTopic.set(topic.id, await allowedTopicAiIds(db, topic));
    }
  }
  const rooms: Array<{ groupId: string; topicId: string; roomLocalpart: string }> = [];
  for (const topic of topicRows) {
    if (topic.isGeneral) {
      continue;
    }
    if (topic.archivedAt !== null) {
      continue;
    }
    if (inTopic.has(topic.id) && (allowedByTopic.get(topic.id)?.has(aiId) ?? false)) {
      rooms.push({ groupId: topic.groupId, topicId: topic.id, roomLocalpart: topic.roomLocalpart });
    }
  }
  // General rooms ride on the `group_ais` rows themselves (one General topic
  // per group, always public, never archived).
  const generals = new Map(
    topicRows.filter((row) => row.isGeneral).map((row) => [row.groupId, row]),
  );
  for (const group of groupRows) {
    const general = generals.get(group.groupId);
    if (general) {
      rooms.push({
        groupId: group.groupId,
        topicId: general.id,
        roomLocalpart: general.roomLocalpart,
      });
    } else {
      // No General row yet (pre-backfill data in a test): fall back to the
      // group's own room so existing AIs keep answering in General.
      rooms.push({ groupId: group.groupId, topicId: '', roomLocalpart: group.roomLocalpart });
    }
  }
  return rooms;
}

interface RoomGateState {
  /** Bare JIDs of the current human members, lowercased. */
  memberJids: Set<string>;
  /** Per-member role for the gate that decides whether a sender may wake an
   * AI for an action (T-0098). Keys are lowercased bare JIDs. */
  memberRolesByJid: Map<string, GroupRole>;
}

// The fresh gate for one topic turn: who may trigger the AI, and which
// nicks belong to AIs. For a General topic the humans are every group
// member; for any other topic they are that topic's members (public topics:
// every group member; private topics: the `topic_members` rows). Member JIDs
// are derived with the same `localpartFor` the provisioning uses, so no
// extra mapping table is needed. Roles come from `group_members` and are
// looked up per turn so a promotion or demotion that lands between turns is
// picked up the next time the AI wakes. A message from someone who is not a
// topic member cannot wake the AI (they cannot even be in the room, but it
// is asserted anyway). The `request_action` role check (T-0098: sender is
// group owner/admin) stays, and additionally requires the sender to be in
// the topic.
async function loadRoomGateState(
  db: ServerDatabase,
  groupId: string,
  domain: string,
  topicId: string,
): Promise<RoomGateState | null> {
  const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return null;
  }
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  let memberIds: Set<string> | null = null;
  if (topic && !topic.isGeneral && topic.visibility === 'private') {
    const rows = await db
      .select({ userId: topicMembers.userId })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topic.id));
    memberIds = new Set(rows.map((row) => row.userId));
  }
  const members = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const memberRolesByJid = new Map<string, GroupRole>();
  const memberJids = new Set<string>();
  for (const row of members) {
    if (memberIds !== null && !memberIds.has(row.userId)) {
      continue;
    }
    const bare = normBareJid(jidFor(localpartFor(row.userId), domain));
    memberJids.add(bare);
    memberRolesByJid.set(bare, row.role);
  }
  return { memberJids, memberRolesByJid };
}

// Agent gateway v0: keeps every active AI online over XMPP and replies to the
// AI's owner in their DM. The AI id always comes from the gateway's own
// connection map, never from message content. Reconnects are xmpp-core's own
// auto-reconnect plus this module's backoff on failed connects and the
// periodic reconcile as a safety net.
export function createAgentGateway(
  deps: AgentGatewayDeps,
  config: AgentGatewayConfig,
): AgentGateway {
  const logger = deps.logger;
  const turnLogger = deps.turnLogger ?? deps.logger;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const retryBaseMs = config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  const createCore = deps.createCore ?? createXmppCore;
  const baseUrl = deps.litellmBaseUrl ?? DEFAULT_LITELLM_BASE_URL;
  const draftHub = deps.drafts?.hub ?? sharedDraftHub;
  const sessions = new Map<string, AiSession>();
  // AIs another gateway replaced while this process runs. `reconcile` and
  // retries never reconnect them again until the gateway restarts. In memory
  // only, keyed by the gateway's own AI ids.
  const superseded = new Set<string>();

  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribes: Array<() => void> = [];

  function nowMs(): number {
    return (deps.now ?? (() => new Date()))().getTime();
  }

  function roomJidFor(roomLocalpart: string): string {
    return normBareJid(`${roomLocalpart}@${deps.xmpp.mucDomain}`);
  }

  function aiDeps(): AiServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      // Checked in `start`: both are present whenever a session runs.
      litellm: deps.litellm as LitellmAdminClient,
      cipher: deps.cipher as KeyCipher,
      logger,
      domain: deps.xmpp.domain,
    };
  }

  function secretsFor(virtualKey?: string): string[] {
    return [
      ...(virtualKey === undefined ? [] : [virtualKey]),
      ...(deps.masterKeyForRedaction === undefined ? [] : [deps.masterKeyForRedaction]),
    ];
  }

  // Indexes this chat when an archive is configured, then reads its pinned
  // facts and memory block. It never throws and never logs text: a failure
  // still lets the reply go out with whatever is already stored.
  async function loadMemoryContext(input: {
    aiId: string;
    chatKey: string;
    archiveOwner: string;
    scope: MemoryScope;
    aiBareJid: string;
    ownerName?: string | undefined;
    now: Date;
    virtualKey?: string | undefined;
  }): Promise<MemoryContext> {
    if (deps.archive !== undefined) {
      try {
        await indexMemory({
          archive: deps.archive,
          db: deps.db,
          aiId: input.aiId,
          chatKey: input.chatKey,
          archiveOwner: input.archiveOwner,
          scope: input.scope,
          aiBareJid: input.aiBareJid,
          ...(input.ownerName === undefined ? {} : { ownerName: input.ownerName }),
          now: input.now,
        });
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
          'AI memory index failed; replying with stored memory',
        );
      }
    }
    try {
      const [facts, lines] = await Promise.all([
        listFacts(deps.db, input.aiId, input.chatKey),
        renderMemoryBlock(deps.db, input.aiId, input.chatKey),
      ]);
      return { facts: facts.map((fact) => fact.text), lines };
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor(input.virtualKey)), aiId: input.aiId },
        'AI memory read failed; replying without stored memory',
      );
      return { facts: [], lines: [] };
    }
  }

  // One fixed notice per AI per chat per UTC day, in memory only. After a
  // restart the map is empty, so a limited AI may notify once more.
  const dailyLimitNotices = new Map<string, string>();
  // One 80% heads-up per kind per AI per chat per UTC day, in memory only.
  // Daily and monthly warnings are independent; a restart may repeat one.
  const dailyWarningNotices = new Map<string, string>();
  const monthlyWarningNotices = new Map<string, string>();

  function utcDay(): string {
    return (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  }

  // The soft daily-limit check (T-0058), shared by DM and group turns. It
  // runs before any model call: a null usage fails open (the turn goes
  // ahead — the monthly cap is still enforced by LiteLLM itself), while a
  // reached limit sends the fixed notice at most once per AI per chat per UTC
  // day and skips the turn. The fetched usage is returned so the caller can
  // send the 80% warnings after the reply without a second read. Only ids
  // are ever logged: the usage read addresses the key by its token id, never
  // by the secret.
  async function checkDailyLimit(input: {
    aiId: string;
    chatKey: string;
    sendNotice: (text: string) => Promise<unknown>;
  }): Promise<{ limited: boolean; usage: AiUsage | null }> {
    if (deps.litellm === undefined) {
      return { limited: false, usage: null };
    }
    let usage;
    try {
      usage = await getAiUsage(
        {
          db: deps.db,
          litellm: deps.litellm,
          logger,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        input.aiId,
      );
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
        'AI usage check failed; failing open',
      );
      return { limited: false, usage: null };
    }
    if (usage === null || !usage.dailyLimitReached) {
      return { limited: false, usage };
    }
    const today = utcDay();
    const key = `${input.aiId}:${input.chatKey}`;
    if (dailyLimitNotices.get(key) === today) {
      return { limited: true, usage };
    }
    try {
      await input.sendNotice(dailyLimitReply(usage.perDayUsd));
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
        'AI daily-limit notice could not be sent',
      );
      return { limited: true, usage };
    }
    dailyLimitNotices.set(key, today);
    logger.info({ aiId: input.aiId }, 'AI daily spending limit reached; turn skipped');
    return { limited: true, usage };
  }

  // Sends the 80% heads-ups after the AI's reply for the turn that crossed
  // them: daily first, then monthly. At most one per kind per AI per chat per
  // UTC day. A reached limit sends nothing: the notice path above applies.
  // Usage null fails open with no warning. A failed send only logs (ids
  // only, never the key or amounts) and never fails the turn.
  async function sendBudgetWarnings(input: {
    aiId: string;
    chatKey: string;
    usage: AiUsage | null;
    sendWarning: (text: string) => Promise<unknown>;
  }): Promise<void> {
    const usage = input.usage;
    if (usage === null || usage.dailyLimitReached) {
      return;
    }
    const today = utcDay();
    if (usage.dailyWarning) {
      const key = `${input.aiId}:${input.chatKey}:daily-warning`;
      if (dailyWarningNotices.get(key) !== today) {
        try {
          await input.sendWarning(dailyWarningReply(usage.todayUsd, usage.perDayUsd));
          dailyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI daily budget warning sent');
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
            'AI budget warning could not be sent',
          );
        }
      }
    }
    if (usage.monthlyWarning) {
      const key = `${input.aiId}:${input.chatKey}:monthly-warning`;
      if (monthlyWarningNotices.get(key) !== today) {
        try {
          await input.sendWarning(monthlyWarningReply(usage.windowUsd, usage.perMonthUsd));
          monthlyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI monthly budget warning sent');
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
            'AI budget warning could not be sent',
          );
        }
      }
    }
  }

  // Per-turn context for a `request_action` call in a group (T-0098). The
  // `groupId` and `topicId` are the room the AI was woken in — they ride
  // along to the action gateway and are used to pick the model-facing
  // wording. The `isStillAllowed` callback re-queries the database right
  // before the action gateway runs, so a role change that landed between
  // the turn starting and the tool executing short-circuits to
  // `denied: not allowed` without calling the gateway. `allowActions` is
  // false when the trigger may not ask for one, so an improvised
  // `request_action` gets `invalid: unknown tool`.
  interface RequestActionContext {
    groupId: string;
    topicId: string;
    isStillAllowed: () => Promise<boolean>;
    allowActions: boolean;
  }

  // Runs one validated tool call against the gateway's own AI id. The id
  // comes from the session, never from the model's arguments, and the
  // `chatKey` comes from the turn. Only `ais.persona` /
  // `ais.previous_persona` (persona tools), the action gateway
  // (request_action) or this chat's memory rows (the memory tools) can
  // change. Log lines carry the AI id, the tool name and the outcome only:
  // never the persona text, a recall query, a block id or a fact.
  function executeToolCall(
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
  ): ExecuteToolCall {
    const aiId = session.aiId;
    // The T-0444 cap: at most five facts saved per turn. The counter lives in
    // this closure, which is created once per turn, so it resets with the
    // turn.
    let savedFacts = 0;
    return async (call) => {
      // A turn that was computing when the AI was stopped must not change the
      // persona afterwards, and a tier-2 action must not run without the
      // owner's approval.
      if (!sessionIsLive(session)) {
        return { content: 'the AI was stopped' };
      }
      // A group turn offers the memory tools always, and `request_action`
      // only when the trigger is allowed to ask for one. The persona tools
      // are reachable from the owner's DM alone, so a model that improvises
      // one in a room (for example after reading a hostile message) gets
      // nothing.
      if (context !== undefined) {
        const isMemoryTool =
          call.tool === RECALL_TOOL ||
          call.tool === MEMORY_ZOOM_TOOL ||
          call.tool === REMEMBER_TOOL;
        if (!isMemoryTool && call.tool !== REQUEST_ACTION_TOOL) {
          return { content: 'invalid: unknown tool' };
        }
        if (call.tool === REQUEST_ACTION_TOOL && !context.allowActions) {
          return { content: 'invalid: unknown tool' };
        }
      }
      if (call.tool === RECALL_TOOL) {
        const lines = await recallMemory(deps.db, aiId, chatKey, call.query);
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
        return { content: lines.length === 0 ? 'no matches' : lines.join('\n') };
      }
      if (call.tool === MEMORY_ZOOM_TOOL) {
        const lines = await zoomMemory(deps.db, aiId, chatKey, call.block);
        if (lines === null) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'invalid: unknown block' };
        }
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
        return { content: lines.length === 0 ? 'empty' : lines.join('\n') };
      }
      if (call.tool === REMEMBER_TOOL) {
        if (savedFacts >= 5) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'refused: at most 5 per turn' };
        }
        if (looksLikeSecret(call.text)) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'refused: looks like a secret' };
        }
        const outcome = await addFact(deps.db, aiId, chatKey, call.text);
        if (outcome === 'saved') {
          savedFacts += 1;
          logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
          return { content: 'ok', notice: formatRememberedLine(call.text) };
        }
        logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
        if (outcome === 'duplicate') {
          return { content: 'already remembered' };
        }
        return { content: 'invalid: one line, at most 280 characters' };
      }
      if (call.tool === UPDATE_PERSONA_TOOL) {
        await setPersonaFromChat(deps.db, aiId, call.persona);
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona updated by chat');
        return { content: 'ok', notice: formatPersonaUpdatedLine(call.summary) };
      }
      if (call.tool === REQUEST_ACTION_TOOL) {
        if (context !== undefined) {
          // The triggering user's role may have changed during a long turn
          // (T-0098): re-check the database before calling the action
          // gateway, and short-circuit to `denied: not allowed` when they
          // are no longer an owner or admin. The gateway is never invoked
          // in that case, so no audit row is written and no card appears.
          const stillAllowed = await context.isStillAllowed();
          if (!stillAllowed) {
            logger.info(
              { aiId: session.aiId, action: call.action, groupId: context.groupId },
              'AI request_action denied: sender no longer allowed',
            );
            return { content: 'denied: not allowed' };
          }
        }
        return runRequestAction(
          session,
          call,
          context === undefined
            ? undefined
            : { groupId: context.groupId, topicId: context.topicId },
        );
      }
      const outcome = await revertPersonaFromChat(deps.db, aiId);
      logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona revert by chat');
      if (outcome === 'nothing to undo') {
        return { content: 'nothing to undo' };
      }
      return { content: 'ok', notice: PERSONA_RESTORED_LINE };
    };
  }

  // Routes a `request_action` call into the action gateway. The ai id and
  // chat ids always come from the session, never from the call: a model
  // that smuggles `aiId` or `groupId` inside `args` cannot change who is
  // asked. The mapping below is the exact model-facing wording per
  // outcome (see spec); no adapter text beyond the success `summary`
  // reaches the AI. The group context (when present) adjusts the
  // pending-approval wording — owners see "in this chat", admins see "in
  // this room" — and tags the request with the room's group and topic ids.
  async function runRequestAction(
    session: AiSession,
    call: Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>,
    chat?: { groupId: string; topicId: string },
  ): Promise<ToolExecution> {
    const actions = deps.actions;
    if (actions === undefined) {
      // No action gateway wired: the tool was never offered, so this call
      // is treated as an unknown tool and answered honestly.
      return { content: 'invalid: unknown tool: request_action' };
    }
    let outcome: RequestOutcome;
    try {
      outcome = await actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
      });
    } catch (error) {
      // The gateway is best-effort: a thrown error here would mean a bug
      // we cannot leak. Log the class name only and answer as failed.
      logger.warn(
        { err: errorName(error), aiId: session.aiId, action: call.action },
        'action gateway request threw',
      );
      return { content: 'the action failed' };
    }
    switch (outcome.status) {
      case 'executed':
        return { content: `done: ${outcome.summary}${formatModelText(outcome.modelText)}` };
      case 'pending_approval':
        // The card message is the owner's view; the model just gets a
        // short fixed line so it knows to wait. The wording differs by
        // chat: in DMs the card appears in the owner's chat, in groups
        // it appears in the room and only group admins / owners / the
        // AI's owner get the buttons.
        return {
          content:
            chat === undefined
              ? "waiting for your owner's approval; a card was posted in this chat"
              : "waiting for an admin's approval; a card was posted in this room",
        };
      case 'failed':
        return { content: 'the action failed' };
      case 'denied':
        return { content: `denied: ${denialReasonForModel(outcome.reason)}` };
    }
  }

  function scheduleRetry(session: AiSession): void {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    session.retryAttempt += 1;
    const delay = retryDelayMs(session.retryAttempt, retryBaseMs);
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
    }
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined;
      if (session.stopped || sessions.get(session.aiId) !== session) {
        return;
      }
      void session.core
        .connect()
        .then(() => {
          session.retryAttempt = 0;
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI reconnect failed; retrying',
          );
          scheduleRetry(session);
        });
    }, delay);
  }

  // Whether a session is still owned by the gateway. T-0080: every send path
  // a running AI turn triggers — DM reply, group reply, budget warnings,
  // daily-limit notice, drafts, persona-tool notice — checks this right
  // before it sends, so a stop that lands mid-turn drops the reply rather
  // than delivering it. `disconnectAi` flips `stopped` to `true` and removes
  // the session from the map; both checks together cover the race.
  function sessionIsLive(session: AiSession): boolean {
    return !session.stopped && sessions.get(session.aiId) === session;
  }

  // Wraps `core.sendMessage` so any send during a turn is skipped the moment
  // the AI is stopped. The skip resolves with an empty id, which matches
  // what `sendMessage` returns for a successful send — the caller still
  // sees a successful path, only the wire never carries the text.
  function liveSendMessage(
    session: AiSession,
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<{ id: string }> {
    if (!sessionIsLive(session)) {
      return Promise.resolve({ id: '' });
    }
    return session.core.sendMessage(to, kind, text, opts);
  }

  // T-0106: per-round gate for the multi-round tool loop. Before each model
  // call the AI must still be live (kill switch) and still under its
  // daily/monthly limits. A limited AI gets the same fixed budget reply the
  // single-round turn would send; a stopped AI gets the stopped reply and
  // sends nothing. Usage null fails open, like the pre-turn check.
  async function checkDmRoundGate(
    session: AiSession,
  ): Promise<{ limited: boolean; reply: string } | null> {
    if (!sessionIsLive(session)) {
      return { limited: true, reply: 'The AI was stopped.' };
    }
    if (deps.litellm === undefined) {
      return null;
    }
    let usage: AiUsage | null;
    try {
      usage = await getAiUsage(
        {
          db: deps.db,
          litellm: deps.litellm,
          logger,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        session.aiId,
      );
    } catch {
      return null;
    }
    if (usage === null || !usage.dailyLimitReached) {
      return null;
    }
    return { limited: true, reply: dailyLimitReply(usage.perDayUsd) };
  }

  // T-0446: one compaction per (AI, chat) at a time, in memory only. The
  // gateway fires `startCompaction` after a turn's reply; it is never awaited,
  // so a slow or failed model call can neither delay nor fail the reply. The
  // daily-limit gate is re-checked here (usage can have crossed the cap since
  // the turn started) and the run never logs prompt or summary text.
  const runningCompactions = new Set<string>();

  function startCompaction(session: AiSession, chatKey: string, virtualKey: string): void {
    const key = `${session.aiId}:${chatKey}`;
    if (runningCompactions.has(key)) {
      return;
    }
    runningCompactions.add(key);
    void (async () => {
      try {
        if ((await checkDmRoundGate(session)) !== null) {
          return;
        }
        const startedAt = nowMs();
        const { built, withheld } = await compactMemory({
          db: deps.db,
          aiId: session.aiId,
          chatKey,
          complete: (prompt) =>
            completeChat({
              baseUrl,
              virtualKey,
              model: modelNameForAi(session.aiId),
              messages: [{ role: 'user', content: prompt }],
              ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
              secrets: secretsFor(),
            }),
        });
        if (built > 0) {
          logger.info(
            { aiId: session.aiId, chatKey, built, withheld, ms: nowMs() - startedAt },
            'AI memory compacted',
          );
        }
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
          'AI memory compaction failed',
        );
      } finally {
        runningCompactions.delete(key);
      }
    })();
  }

  // T-0106: appends the fixed tool guide to the last user turn. The system
  // prompt builders take no options (their shape is frozen for provider
  // caching), so the guide rides as a separate user turn right before the
  // trigger. Only called when tools are enabled and adapters are
  // registered; otherwise the messages pass through untouched.
  function withToolGuide(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return [...messages, { role: 'user', content: TOOL_GUIDE }];
  }

  // T-0106: posts one live progress message for a multi-round turn and
  // updates it at each round (XMPP message correction, the same mechanism
  // streaming replies use). Stage texts come from the fixed table in
  // `agents/tool-guide.ts` — never model text, never tool output. Best
  // effort: a failed post or update warns with ids only and the turn
  // continues. Resolves with the progress message id when one was posted,
  // else null.
  function liveProgressReporter(
    session: AiSession,
    to: string,
    kind: ChatKind,
    aiJid: string,
  ): {
    reportProgress: (stage: string) => Promise<string | null>;
    clearProgress: () => Promise<void>;
  } {
    let progressId: string | null = null;
    return {
      reportProgress: async (stage: string): Promise<string | null> => {
        if (!sessionIsLive(session)) {
          return null;
        }
        const payload = { v: 0 as const, type: 'progress' as const, data: { ai: aiJid, stage } };
        try {
          if (progressId === null) {
            const sent = await session.core.sendMessage(to, kind, stage, { payload });
            progressId = sent.id === '' ? null : sent.id;
            return progressId;
          }
          await session.core.sendCorrection(to, kind, progressId, stage);
          return progressId;
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI progress message could not be sent',
          );
          return progressId;
        }
      },
      clearProgress: async (): Promise<void> => {
        // The final text replaces the progress line: clients render the
        // newest message, and the progress card drops out of view. A
        // correction keeps one bubble instead of leaving a stale
        // "working on it" line next to the answer. Best effort like
        // every other progress send.
        if (progressId === null || !sessionIsLive(session)) {
          return;
        }
        try {
          await session.core.sendRetraction(to, kind, progressId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI progress message could not be cleared',
          );
        }
        progressId = null;
      },
    };
  }

  function liveSendTyping(
    session: AiSession,
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.sendTyping(to, kind, state);
  }

  function liveMarkDisplayed(
    session: AiSession,
    chatJid: string,
    kind: ChatKind,
    messageId: string,
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.markDisplayed(chatJid, kind, messageId);
  }

  async function connectAi(record: ActiveAiForGateway): Promise<void> {
    if (!started || sessions.has(record.id) || superseded.has(record.id)) {
      return;
    }
    const aiId = record.id;
    const aiJid = record.jid;
    let core: XmppCore;
    try {
      core = createCore({
        service: deps.xmpp.wsPublicUrl,
        domain: deps.xmpp.domain,
        resource: GATEWAY_RESOURCE,
        getToken: async () => {
          const issued = await issueXmppToken(deps.xmpp, aiJid, XMPP_TOKEN_TTL_SECONDS);
          return { jid: aiJid, token: issued.token };
        },
      });
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI client could not be created',
      );
      return;
    }

    const session: AiSession = {
      aiId,
      aiJid,
      core,
      busy: false,
      pending: [],
      stopped: false,
      retryAttempt: 0,
      retryTimer: undefined,
      unsubs: [],
      rooms: new Map(),
      roomPending: new Map(),
      roomBusy: new Set(),
      roomTurns: new Map(),
    };
    sessions.set(aiId, session);
    session.unsubs.push(
      core.on('message', (message) => {
        handleIncoming(session, message);
      }),
      core.on('replaced', () => {
        handleReplaced(session);
      }),
      core.on('status', (status) => {
        // Tokens never appear here: only the AI id is logged.
        if (status === 'online') {
          logger.info({ aiId }, 'AI is online');
        } else if (status === 'offline') {
          logger.warn({ aiId }, 'AI is offline');
        }
      }),
    );

    try {
      await core.connect();
      session.retryAttempt = 0;
    } catch (error) {
      // One AI failing to connect must never stop the others; the retry
      // timer and the reconcile loop pick it up later.
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI failed to connect; retrying',
      );
      scheduleRetry(session);
      return;
    }
    // The gateway may have stopped while the login was in flight: never keep
    // a connection nobody owns any more.
    if (!started || session.stopped || sessions.get(aiId) !== session) {
      await disconnectAi(aiId).catch(() => undefined);
      return;
    }
    // Rooms never break DMs: a room sync failure is logged inside and the
    // session stays up for DMs either way.
    await syncAiRooms(session, record.name);
  }

  async function disconnectAi(aiId: string): Promise<void> {
    const session = sessions.get(aiId);
    if (session === undefined) {
      return;
    }
    sessions.delete(aiId);
    session.stopped = true;
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
      session.retryTimer = undefined;
    }
    for (const unsub of session.unsubs) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    session.unsubs = [];
    try {
      await session.core.disconnect();
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()), aiId }, 'AI disconnect failed');
    }
    logger.info({ aiId }, 'AI is offline');
  }

  // Drifts the AI's room joins toward the database: joins every room the AI
  // belongs to with the AI's name as nick, re-joins when the nick went stale,
  // and leaves rooms the AI no longer belongs to. A join failure is logged
  // (ids only) and retried by the next reconcile; it never throws and never
  // breaks the AI's DMs.
  async function syncAiRooms(session: AiSession, aiName: string): Promise<void> {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    let rooms: Array<{ groupId: string; topicId: string; roomLocalpart: string }>;
    try {
      rooms = await listAiRooms(deps.db, session.aiId);
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI rooms lookup failed',
      );
      return;
    }
    const wanted = new Set<string>();
    for (const room of rooms) {
      const roomJid = roomJidFor(room.roomLocalpart);
      wanted.add(roomJid);
      const known = session.rooms.get(roomJid);
      if (known !== undefined && known.nick === aiName) {
        continue;
      }
      if (known !== undefined) {
        await leaveRoomQuietly(session, roomJid, known.groupId);
      }
      try {
        await session.core.joinRoom(roomJid, aiName);
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: session.aiId, groupId: room.groupId },
          'AI room join failed; reconcile will retry',
        );
        continue;
      }
      session.rooms.set(roomJid, {
        groupId: room.groupId,
        topicId: room.topicId,
        joinedAtMs: nowMs(),
        nick: aiName,
      });
      logger.info({ aiId: session.aiId, groupId: room.groupId }, 'AI joined the room');
    }
    for (const [roomJid, sub] of session.rooms) {
      if (!wanted.has(roomJid)) {
        await leaveRoomQuietly(session, roomJid, sub.groupId);
      }
    }
  }

  async function leaveRoomQuietly(
    session: AiSession,
    roomJid: string,
    groupId: string,
  ): Promise<void> {
    session.rooms.delete(roomJid);
    session.roomPending.delete(roomJid);
    session.roomBusy.delete(roomJid);
    // A re-added AI starts with a fresh rate budget.
    session.roomTurns.delete(roomJid);
    try {
      await session.core.leaveRoom(roomJid);
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId, groupId },
        'AI room leave failed',
      );
      return;
    }
    logger.info({ aiId: session.aiId, groupId }, 'AI left the room');
  }

  // Looks up the AI's owner id from the database. The owner JID is derived
  // the same way the rest of the platform derives it (via `localpartFor` and
  // `jidFor`), so a DM announcement lands where the gateway already talks.
  async function loadOwnerId(aiId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ owner: ais.owner })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    return row?.owner ?? null;
  }

  // Looks up the room JID (bare) for one group. Returns `null` when the
  // group does not exist; the caller answers `false` for that case too.
  async function loadRoomJid(groupId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ roomLocalpart: groups.roomLocalpart })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  }

  // Looks up the room JID (bare) for one topic. Returns `null` when the
  // topic does not exist or is archived; the caller answers `false` for
  // those cases too.
  async function loadTopicRoomJid(topicId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ roomLocalpart: topics.roomLocalpart, archivedAt: topics.archivedAt })
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1);
    if (row === undefined || row.archivedAt !== null) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  }

  // Builds the `SendMessageOptions` for one `postToChat` call. The
  // `payload` field is only present when the caller actually passed one.
  function sendOptions(input: { text: string; payload?: Payload }): SendMessageOptions {
    return input.payload === undefined ? {} : { payload: input.payload };
  }

  // T-0092: posts one message from the AI's live XMPP session into the chat
  // the action gateway asked about. The session must be live (not stopped,
  // still owned by this gateway), the AI must exist, and — for a group —
  // the session must currently hold a subscription to the room. Any other
  // answer is `false` with no send, so a stopped AI (kill switch) and an
  // AI that was never in the room stay silent. T-0109: an optional `topicId`
  // posts into that topic's room instead (the AI must be a member and the
  // topic live); otherwise the group post goes into General (the group's own
  // room) or the DM. `session.rooms.has(roomJid)` remains the guard.
  async function postToChat(input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }): Promise<boolean> {
    const session = sessions.get(input.aiId);
    if (session === undefined || !sessionIsLive(session)) {
      return false;
    }
    if (input.groupId === null) {
      const ownerId = await loadOwnerId(input.aiId);
      if (ownerId === null) {
        return false;
      }
      const ownerJid = jidFor(localpartFor(ownerId), deps.xmpp.domain);
      await liveSendMessage(session, ownerJid, 'chat', input.text, sendOptions(input));
      return true;
    }
    if (input.topicId !== undefined) {
      const topicJid = await loadTopicRoomJid(input.topicId);
      if (topicJid === null) {
        return false;
      }
      if (!session.rooms.has(topicJid)) {
        return false;
      }
      await liveSendMessage(session, topicJid, 'groupchat', input.text, sendOptions(input));
      return true;
    }
    const roomJid = await loadRoomJid(input.groupId);
    if (roomJid === null) {
      return false;
    }
    if (!session.rooms.has(roomJid)) {
      return false;
    }
    await liveSendMessage(session, roomJid, 'groupchat', input.text, sendOptions(input));
    return true;
  }

  // Another gateway logged this AI in with the same resource and ejabberd
  // replaced this session: the newest gateway wins, so this process stands
  // down for the AI and never reconnects it until a restart. Pending
  // messages are dropped and no new turns start; a turn already in flight
  // may finish, but its final send fails quietly once torn down.
  function handleReplaced(session: AiSession): void {
    if (sessions.get(session.aiId) !== session) {
      return;
    }
    superseded.add(session.aiId);
    // The AI id only: never tokens, JIDs with tokens, or message bodies.
    logger.warn({ aiId: session.aiId }, 'AI session replaced by another gateway; standing down');
    session.pending.length = 0;
    session.roomPending.clear();
    void disconnectAi(session.aiId).catch(() => undefined);
  }

  async function reconcile(): Promise<void> {
    let active: ActiveAiForGateway[];
    try {
      active = await listActiveAisForGateway(deps.db);
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()) }, 'AI reconcile failed');
      return;
    }
    const wanted = new Set(active.map((ai) => ai.id));
    for (const ai of active) {
      try {
        const existing = sessions.get(ai.id);
        if (existing === undefined) {
          await connectAi(ai);
        } else {
          // Rooms drift without a reconnect: a missed group event, a failed
          // join, or a stale nick is picked up here at the latest.
          await syncAiRooms(existing, ai.name);
        }
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: ai.id },
          'AI reconcile connect failed',
        );
      }
    }
    for (const aiId of sessions.keys()) {
      if (!wanted.has(aiId)) {
        try {
          await disconnectAi(aiId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI reconcile disconnect failed',
          );
        }
      }
    }
  }

  function handleIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction of a message is never a new turn, in a DM or in a
    // room: the AI re-answering edits is out of scope. This is the first check,
    // before any routing, pairing, database or model work.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    if (message.kind === 'groupchat') {
      handleRoomIncoming(session, message);
      return;
    }
    // v0 answers DMs only. Groups, own messages and empty bodies are ignored
    // before any database or model work.
    if (message.kind !== 'chat' || message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    session.pending.push({ id: message.id, body, fromJid: message.fromJid });
    // `busy` is reset in the pump's `finally`, but a truly unexpected throw
    // still needs a redacted log line rather than an unhandled rejection.
    void pumpSession(session).catch((error: unknown) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI pump failed',
      );
    });
  }

  // M2 rule 1 (§9.4): a person @mentions AIs, and only those AIs reply. Every
  // check that needs no database runs here; the sender's membership and the
  // rate limit are checked fresh at turn time.
  function handleRoomIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction in a room is never a mention: it starts no turn.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    if (message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    const roomJid = normBareJid(message.chatJid);
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      // Not a room this AI joined: strangers' rooms are never answered.
      return;
    }
    // History replayed on join carries its original stamp, far older than the
    // join. Live messages carry ~now.
    if (message.timestamp.getTime() < room.joinedAtMs - GROUP_JOIN_SKEW_MS) {
      return;
    }
    const aiBare = normBareJid(session.aiJid);
    const mentioned = (message.mentions ?? []).some(
      (mention) => normBareJid(mention.jid) === aiBare,
    );
    if (!mentioned) {
      // No mention, nobody replies (M2 rule 3).
      return;
    }
    // No AI-to-AI turns in M2: any `ai-*` real JID never wakes the AI. An
    // occupant whose real JID is unknown is decided at turn time by nick.
    if (isAiSender(normBareJid(message.fromJid))) {
      return;
    }
    const queued = session.roomPending.get(roomJid) ?? [];
    queued.push({
      id: message.id,
      body,
      fromJid: message.fromJid,
      fromResolved: message.fromResolved,
      ...(message.fromNick === undefined ? {} : { fromNick: message.fromNick }),
      timestamp: message.timestamp,
    });
    session.roomPending.set(roomJid, queued);
    void pumpRoom(session, roomJid).catch((error: unknown) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI group pump failed',
      );
    });
  }

  // One turn at a time per (AI, room). Messages arriving during a turn are
  // coalesced: when the turn ends, one more turn runs if new mentions came in.
  async function pumpRoom(session: AiSession, roomJid: string): Promise<void> {
    if (session.roomBusy.has(roomJid)) {
      return;
    }
    session.roomBusy.add(roomJid);
    try {
      while (!session.stopped) {
        const batch = session.roomPending.get(roomJid) ?? [];
        if (batch.length === 0) {
          break;
        }
        session.roomPending.set(roomJid, []);
        await runGroupSessionTurn(session, roomJid, batch);
      }
    } finally {
      session.roomBusy.delete(roomJid);
    }
  }

  async function runGroupSessionTurn(
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
  ): Promise<void> {
    // The AI id below is the gateway's own: it keyed this session, so nothing
    // here can be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      return;
    }
    const gate = await loadRoomGateState(
      deps.db,
      room.groupId,
      deps.xmpp.domain,
      room.topicId,
    ).catch(() => null);
    if (gate === null) {
      logger.warn({ aiId: session.aiId, groupId: room.groupId }, 'AI group state lookup failed');
      return;
    }
    const eligible: RoomPendingMessage[] = [];
    for (const item of batch) {
      const fromBare = normBareJid(item.fromJid);
      if (isAiSender(fromBare)) {
        continue;
      }
      if (!item.fromResolved) {
        // The real JID is unknown: never a turn. That covers both spec
        // clauses at once — an occupant nick matching a room AI would be an
        // AI-to-AI turn, and anything else can't pass the human-membership
        // check below anyway.
        continue;
      }
      // Only a current human member's mention triggers a reply. Members are
      // people: every `ai-*` sender already returned above.
      if (!gate.memberJids.has(fromBare)) {
        continue;
      }
      eligible.push(item);
    }
    if (eligible.length === 0) {
      return;
    }
    const trigger = eligible[eligible.length - 1] as RoomPendingMessage;

    // The soft daily limit is checked before the rate budget and any model
    // call: a limited AI sends at most one fixed notice per room per UTC day
    // (a plain room message, no mention) and further mentions get nothing.
    // The usage read also decides the 80% warnings, which go out after the
    // reply below — never for a skipped or rate-limited turn. The notice
    // goes through `liveSendMessage` so a stop that lands between the spend
    // read and the notice is silently dropped.
    const groupChatKey = `room:${roomJid}`;
    const groupBudget = await checkDailyLimit({
      aiId: session.aiId,
      chatKey: groupChatKey,
      sendNotice: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
    });
    if (groupBudget.limited) {
      return;
    }

    const atMs = nowMs();
    const recent = (session.roomTurns.get(roomJid) ?? []).filter(
      (stamp) => stamp > atMs - GROUP_RATE_WINDOW_MS,
    );
    if (recent.length >= GROUP_TURNS_PER_WINDOW) {
      session.roomTurns.set(roomJid, recent);
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        'AI group rate limit reached; dropping the turn',
      );
      return;
    }
    recent.push(atMs);
    session.roomTurns.set(roomJid, recent);

    // The room history the AI reads for a turn is that topic's room only:
    // the `roomJid` above is the joined topic room, and `loadHistory` reads
    // that room alone. The trigger is always inside it (checked at enqueue).
    const senderName = displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick });
    // T-0109: names for the topic-aware system prompt. Best effort: a lookup
    // failure keeps the old generic prompt. The topic name goes to the model
    // alone, never into another topic's turn or any log line.
    let groupName: string | undefined;
    let topicName: string | undefined;
    try {
      const [groupRow] = await deps.db
        .select({ title: groups.title })
        .from(groups)
        .where(eq(groups.id, room.groupId))
        .limit(1);
      groupName = groupRow?.title;
    } catch {
      // Best effort: the turn still runs with the generic prompt.
    }
    if (room.topicId !== '') {
      try {
        const [topicRow] = await deps.db
          .select({ name: topics.name })
          .from(topics)
          .where(eq(topics.id, room.topicId))
          .limit(1);
        topicName = topicRow?.name;
      } catch {
        // Best effort: the turn still runs with the generic prompt.
      }
    }
    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(roomJid, 'groupchat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI group history lookup failed; replying without history',
        );
      }

      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      const memory = await loadMemoryContext({
        aiId: session.aiId,
        chatKey: groupChatKey,
        archiveOwner: roomJid,
        scope: { kind: 'room', room: roomJid },
        aiBareJid: normBareJid(ai.jid),
        now,
        virtualKey,
      });
      // The batch is newer than the archive may know: merge the eligible
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every mention that arrived, and the context
      // builder below deduplicates the trigger by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = eligible
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: roomJid,
          kind: 'groupchat' as const,
          fromJid: item.fromJid,
          fromResolved: item.fromResolved,
          ...(item.fromNick === undefined ? {} : { fromNick: item.fromNick }),
          body: item.body,
          timestamp: item.timestamp,
          outgoing: false,
        }));
      const messages: ChatCompletionMessage[] = buildGroupMessages({
        aiName: ai.name,
        persona: ai.persona,
        senderName,
        today,
        aiJid: ai.jid,
        ...(groupName === undefined ? {} : { groupName }),
        ...(topicName === undefined ? {} : { topicName }),
        history: [...history, ...fresh],
        trigger: { id: trigger.id, body: trigger.body },
        memory,
      });

      // T-0098/T-0444: decide per turn, from the database, whether the
      // trigger's sender is allowed to ask the AI for an action. The role
      // lives on the `roomGate` we already loaded; a plain `member`, an AI
      // sender or an unknown occupant does not get `request_action`. Every
      // room turn still carries the three memory tools (T-0444), so the tool
      // loop always runs.
      const triggerBare = normBareJid(trigger.fromJid);
      const triggerRole = gate.memberRolesByJid.get(triggerBare);
      const allowedForAction = triggerRole === 'owner' || triggerRole === 'admin';
      const actionsList = deps.actions?.listActions() ?? [];
      const allowActions = allowedForAction && actionsList.length > 0;
      const groupTools = buildGroupTools(allowedForAction ? actionsList : []);
      // The re-check callback runs at tool-execution time. A `plain
      // member` turn never offers `request_action`, so this never fires for
      // them; for an admin/owner turn it queries the same gate so a
      // demotion that landed between the mention and the tool call
      // short-circuits to `denied: not allowed` without invoking the
      // action gateway.
      const isStillAllowed = async (): Promise<boolean> => {
        const fresh = await loadRoomGateState(
          deps.db,
          room.groupId,
          deps.xmpp.domain,
          room.topicId,
        );
        if (fresh === null) {
          return false;
        }
        const role = fresh.memberRolesByJid.get(triggerBare);
        // T-0109: the sender must still be a group owner/admin AND a member
        // of this topic. Either check failing denies the action.
        return (role === 'owner' || role === 'admin') && fresh.memberJids.has(triggerBare);
      };

      // No persona tools in groups and no drafts: the reply goes straight to
      // the room with `composing`/`paused` chat states around it. The 80%
      // warnings go out after it, so the owner reads the answer first. The
      // `live*` wrappers drop the reply when the AI was stopped between the
      // mention arriving and the LLM call resolving. The room reply always
      // goes through the same tool loop as DMs (T-0098, extended by T-0444);
      // the executor carries the room's group id, the re-check callback and
      // whether `request_action` is allowed.
      // T-0106: the guide is appended to the last user turn only when tools
      // are enabled and the room offers `request_action`; the loop runs
      // `toolMaxRounds` rounds with a live progress message.
      const groupProgress = liveProgressReporter(session, roomJid, 'groupchat', ai.jid);
      const groupMessages =
        deps.toolsEnabled === true && allowActions ? withToolGuide(messages) : messages;
      await runGroupTurn({
        aiId: session.aiId,
        roomJid,
        triggerId: trigger.id,
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages: groupMessages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        tools: groupTools,
        executeTool: executeToolCall(session, groupChatKey, {
          groupId: room.groupId,
          topicId: room.topicId,
          isStillAllowed,
          allowActions,
        }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        checkRoundGate: () => checkDmRoundGate(session),
        reportProgress: groupProgress.reportProgress,
        clearProgress: groupProgress.clearProgress,
        // T-0156: the per-turn counts line (ids and counts only), like the
        // DM path below.
        turnLogger,
        sendMessage: (to, kind, text, opts) => liveSendMessage(session, to, kind, text, opts),
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      await sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: groupChatKey,
        usage: groupBudget.usage,
        sendWarning: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      });
      startCompaction(session, groupChatKey, virtualKey);
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message in the room, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI group turn failed',
      );
      const reply = mapFailureToReply(error);
      const name = senderName.trim() === '' ? normBareJid(trigger.fromJid) : senderName.trim();
      try {
        await liveSendMessage(session, roomJid, 'groupchat', `@${name} ${reply}`, {
          replyTo: { id: trigger.id },
          mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }],
        });
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      try {
        liveSendTyping(session, roomJid, 'groupchat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
    }
  }

  // One turn at a time per AI. Messages arriving during a turn are coalesced:
  // when the turn ends, one more turn runs if new owner messages came in.
  async function pumpSession(session: AiSession): Promise<void> {
    if (session.busy) {
      return;
    }
    session.busy = true;
    try {
      while (session.pending.length > 0 && !session.stopped) {
        const batch = session.pending.splice(0, session.pending.length);
        await runSessionTurn(session, batch);
      }
    } finally {
      session.busy = false;
    }
  }

  async function runSessionTurn(session: AiSession, batch: PendingMessage[]): Promise<void> {
    // The owner JID comes from the database, never from the message. The AI
    // id below is the gateway's own: it keyed this session, so `ensureAiModel`
    // can never be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const ownerJid = jidFor(localpartFor(ai.owner), deps.xmpp.domain);
    const ownerBare = bareJid(ownerJid);
    // The owner always wins; other `ai-*` senders get no turn (which rules
    // out AI-to-AI loops) and strangers get none either.
    const ownerMessages: PendingMessage[] = [];
    for (const item of batch) {
      const from = bareJid(item.fromJid);
      if (from === ownerBare) {
        ownerMessages.push(item);
      } else if (isAiSender(from)) {
        // Another AI (or our own reflection): never a turn, never a loop.
      }
      // Anything else is a stranger and is ignored.
    }
    if (ownerMessages.length === 0) {
      // Strangers, other `ai-*` senders (no AI-to-AI loops) and anything else
      // get no turn and no LiteLLM call.
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    // The owner's ticks turn to read: one XEP-0333 displayed marker per turn
    // for the last owner message of the batch. `trigger.id` is the incoming
    // `ChatMessage.id`, the same id the owner's client stores and matches
    // received markers against (the archive stanza-id when known, else the
    // stanza id). Only owner messages are ever marked: strangers and other
    // AIs returned above, before this point. The `liveMarkDisplayed` wrapper
    // drops the marker when the AI was stopped between the message arriving
    // and the marker going out.
    liveMarkDisplayed(session, ownerJid, 'chat', trigger.id);

    // The soft daily limit holds even when the marker above already went out:
    // a limited AI answers with at most one notice per day, and further
    // messages that day get no reply and no notice. The usage read also
    // decides the 80% warnings, which go out after the reply below.
    const dmChatKey = `dm:${ownerBare}`;
    const dmBudget = await checkDailyLimit({
      aiId: session.aiId,
      chatKey: dmChatKey,
      sendNotice: (text) => liveSendMessage(session, ownerJid, 'chat', text),
    });
    if (dmBudget.limited) {
      return;
    }

    // Each turn streams its drafts to the owner under one turn id. The
    // publisher throttles (150 ms); the complete reply is flushed as a draft
    // right before the final XMPP send (`beforeFinalSend`), so the last
    // `draft` carries the final text; `end` always comes after the final XMPP
    // message below. Typing indicators stay exactly as before, for clients
    // without drafts.
    const turnDrafts = draftHub.publishTurn(ai.owner, ai.jid, randomUUID());
    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(ownerJid, 'chat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI history lookup failed; replying without history',
        );
      }

      const ownerName = await loadOwnerName(deps.db, ai.owner);
      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      const memory = await loadMemoryContext({
        aiId: session.aiId,
        chatKey: dmChatKey,
        archiveOwner: ai.localpart,
        scope: { kind: 'dm', peer: ownerBare },
        aiBareJid: bareJid(ai.jid),
        ownerName,
        now,
        virtualKey,
      });
      // The batch is newer than the archive may know: merge the triggering
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every message that arrived, and the trigger below
      // deduplicates against the last one by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = ownerMessages
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: session.aiJid,
          kind: 'chat' as const,
          fromJid: ownerJid,
          fromResolved: true,
          body: item.body,
          timestamp: now,
          outgoing: false,
        }));
      const messages: ChatCompletionMessage[] = buildDmMessages({
        aiName: ai.name,
        persona: ai.persona,
        ownerName,
        today,
        aiJid: ai.jid,
        ownerJid,
        history: [...history, ...fresh],
        trigger,
        memory,
      });
      // T-0106: the guide rides as a trailing user turn only when tools are
      // enabled and tool/routine adapters are registered (a non-empty
      // action list, so `request_action` is actually offered). Otherwise
      // today's messages, byte for byte.
      const dmActionsList = deps.actions?.listActions() ?? [];
      const dmMessages =
        deps.toolsEnabled === true && dmActionsList.length > 0 ? withToolGuide(messages) : messages;

      // `end` always comes after the final XMPP message: `runDmTurn` sends
      // it before resolving. Every send and draft push is gated by a
      // `live*` wrapper so a stop that lands between the LLM call and the
      // final send drops the reply (and every draft) instead of delivering
      // it. The `end` itself runs unconditionally so the owner's client
      // sees the turn terminate instead of hanging.
      // T-0106: multi-round turns post one live progress message at the
      // first tool round and update it per round; it is retracted when the
      // final text lands. Best effort: the turn never fails over it.
      const dmProgress = liveProgressReporter(session, ownerJid, 'chat', ai.jid);
      const outcome = await runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages: dmMessages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        executeTool: executeToolCall(session, dmChatKey),
        tools: buildTools(deps.actions?.listActions() ?? []),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        checkRoundGate: () => checkDmRoundGate(session),
        reportProgress: dmProgress.reportProgress,
        clearProgress: dmProgress.clearProgress,
        // T-0156: wires the per-turn counts line (ids and counts only,
        // never content) into production — the wire the T-0106 review
        // deferred.
        turnLogger,
        onDelta: (textSoFar) => {
          if (sessionIsLive(session)) {
            turnDrafts.push(textSoFar);
          }
        },
        beforeFinalSend: (text) => {
          if (sessionIsLive(session)) {
            turnDrafts.flush(text);
          }
        },
        sendMessage: (to, kind, text) => liveSendMessage(session, to, kind, text),
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed');
      // The 80% heads-ups go out after the reply, so the owner reads the
      // answer first. A failed warning send only logs and never fails the
      // turn.
      await sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: dmChatKey,
        usage: dmBudget.usage,
        sendWarning: (text) => liveSendMessage(session, ownerJid, 'chat', text),
      });
      startCompaction(session, dmChatKey, virtualKey);
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI turn failed',
      );
      const reply = mapFailureToReply(error);
      try {
        await liveSendMessage(session, ownerJid, 'chat', reply);
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      // The failed `end` goes out only after the failure text was sent (or
      // its send was attempted): the contract promises `end` comes last.
      try {
        liveSendTyping(session, ownerJid, 'chat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
      turnDrafts.end('failed');
    }
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    if (!config.enabled) {
      logger.info({}, 'agent gateway is disabled');
      return;
    }
    if (deps.litellm === undefined || deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs LiteLLM and the key cipher; staying off');
      return;
    }
    started = true;
    superseded.clear();
    await reconcile();
    unsubscribes.push(
      onAiLifecycle((event) => {
        if (!started) {
          return;
        }
        if (event.type === 'created' || event.type === 'resumed') {
          // `loadActiveAi` is the same `WHERE status = 'active'` filter the
          // periodic reconcile uses (T-0080): a `stopped` or `disabled` row
          // never wakes the gateway back up, even on the notifier path.
          void loadActiveAi(deps.db, event.aiId)
            .then((record) => {
              if (record !== null) {
                return connectAi(record);
              }
            })
            .catch((error: unknown) => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
                event.type === 'created'
                  ? 'AI post-create connect failed'
                  : 'AI post-resume connect failed',
              );
            });
        } else {
          // `stopped` and `deleted` both go through `disconnectAi`: the
          // session is removed from the map, `session.stopped` is set so
          // every send path skips, and queued turns are dropped with the
          // session. For `stopped` the periodic safety net never reconnects
          // (the row is no longer in `listActiveAisForGateway`); a delete
          // tears the row down on its own.
          void disconnectAi(event.aiId).catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              event.type === 'stopped'
                ? 'AI post-stop disconnect failed'
                : 'AI post-delete disconnect failed',
            );
          });
        }
      }),
      onGroupAi((event) => {
        if (!started) {
          return;
        }
        // A join or leave for a live session syncs right away; anything
        // missed (an AI with no session yet) is picked up by `reconcile`.
        // Only ids travel on the event.
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
      // T-0109: the sibling event for per-topic AI membership. A newly added
      // or removed membership shows up without waiting for the next full
      // reconcile, through the same right-away sync as the group event.
      onTopicAi((event) => {
        if (!started) {
          return;
        }
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
    );
    timer = setInterval(() => {
      if (started) {
        void reconcile();
      }
    }, reconcileIntervalMs);
  }

  async function stop(): Promise<void> {
    started = false;
    superseded.clear();
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    unsubscribes = [];
    for (const aiId of sessions.keys()) {
      try {
        await disconnectAi(aiId);
      } catch {
        // Shutdown disconnects everyone; one failure stops nothing else.
      }
    }
  }

  return {
    start,
    stop,
    reconcile,
    size: () => sessions.size,
    aiIds: () => [...sessions.keys()],
    postToChat,
  };
}
