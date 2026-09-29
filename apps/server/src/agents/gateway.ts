import {
  createXmppCore,
  type ChatMessage,
  type XmppCore,
  type XmppCoreOptions,
} from '@galena/xmpp-core';
import { and, eq } from 'drizzle-orm';
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
import { ais, groupAis, groupMembers, groups, llmVirtualKeys, user } from '../db/schema';
import { sharedDraftHub, type DraftHub } from '../drafts/hub';
import { onGroupAi } from '../groups/events';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { XmppConfig } from '../xmpp/config';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { issueXmppToken } from '../xmpp/token';
import {
  bareJid,
  buildDmMessages,
  buildGroupMessages,
  displayNameOf,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
} from './context';
import { getAiUsage, type AiUsage } from '../ais/usage';
import {
  dailyLimitReply,
  dailyWarningReply,
  mapFailureToReply,
  monthlyWarningReply,
  runDmTurn,
  runGroupTurn,
  type ExecuteToolCall,
} from './reply';
import { formatPersonaUpdatedLine, PERSONA_RESTORED_LINE, UPDATE_PERSONA_TOOL } from './tools';

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
  litellmBaseUrl?: string;
  /** Only used to redact log lines; never sent anywhere. */
  masterKeyForRedaction?: string;
  createCore?: (options: XmppCoreOptions) => XmppCore;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Draft hub for live reply drafts. Defaults to the shared server hub. */
  drafts?: { hub?: DraftHub };
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
}

function isAiSender(bare: string): boolean {
  return (bare.split('@')[0] ?? '').startsWith('ai-');
}

function retryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
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

// Every room an AI belongs to: its group_ais rows joined with groups.
async function listAiRooms(
  db: ServerDatabase,
  aiId: string,
): Promise<Array<{ groupId: string; roomLocalpart: string }>> {
  return db
    .select({ groupId: groupAis.groupId, roomLocalpart: groups.roomLocalpart })
    .from(groupAis)
    .innerJoin(groups, eq(groups.id, groupAis.groupId))
    .where(eq(groupAis.aiId, aiId));
}

interface RoomGateState {
  /** Bare JIDs of the current human members, lowercased. */
  memberJids: Set<string>;
}

// The fresh gate for one group turn: who may trigger the AI, and which nicks
// belong to AIs. Member JIDs are derived with the same `localpartFor` the
// provisioning uses, so no extra mapping table is needed.
async function loadRoomGateState(
  db: ServerDatabase,
  groupId: string,
  domain: string,
): Promise<RoomGateState | null> {
  const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return null;
  }
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return {
    memberJids: new Set(
      members.map((row) => normBareJid(jidFor(localpartFor(row.userId), domain))),
    ),
  };
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

  // Runs one validated persona tool call against the gateway's own AI id. The
  // id comes from the session, never from the model's arguments, and only
  // `ais.persona` and `ais.previous_persona` can change. Log lines carry the
  // AI id, the tool name and the outcome only: never the persona text.
  function executePersonaTool(aiId: string): ExecuteToolCall {
    return async (call) => {
      if (call.tool === UPDATE_PERSONA_TOOL) {
        await setPersonaFromChat(deps.db, aiId, call.persona);
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona updated by chat');
        return { content: 'ok', notice: formatPersonaUpdatedLine(call.summary) };
      }
      const outcome = await revertPersonaFromChat(deps.db, aiId);
      logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona revert by chat');
      if (outcome === 'nothing to undo') {
        return { content: 'nothing to undo' };
      }
      return { content: 'ok', notice: PERSONA_RESTORED_LINE };
    };
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
    let rooms: Array<{ groupId: string; roomLocalpart: string }>;
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
      session.rooms.set(roomJid, { groupId: room.groupId, joinedAtMs: nowMs(), nick: aiName });
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
    const gate = await loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain).catch(() => null);
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
    // reply below — never for a skipped or rate-limited turn.
    const groupChatKey = `room:${roomJid}`;
    const groupBudget = await checkDailyLimit({
      aiId: session.aiId,
      chatKey: groupChatKey,
      sendNotice: (text) => session.core.sendMessage(roomJid, 'groupchat', text),
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

    const senderName = displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick });
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
        history: [...history, ...fresh],
        trigger: { id: trigger.id, body: trigger.body },
      });

      // No persona tools in groups and no drafts: the reply goes straight to
      // the room with `composing`/`paused` chat states around it. The 80%
      // warnings go out after it, so the owner reads the answer first.
      await runGroupTurn({
        aiId: session.aiId,
        roomJid,
        triggerId: trigger.id,
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        sendMessage: (to, kind, text, opts) => session.core.sendMessage(to, kind, text, opts),
        sendTyping: (to, kind, state) => {
          session.core.sendTyping(to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      await sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: groupChatKey,
        usage: groupBudget.usage,
        sendWarning: (text) => session.core.sendMessage(roomJid, 'groupchat', text),
      });
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
        await session.core.sendMessage(roomJid, 'groupchat', `@${name} ${reply}`, {
          replyTo: { id: trigger.id },
          mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }],
        });
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      try {
        session.core.sendTyping(roomJid, 'groupchat', 'paused');
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
    // AIs returned above, before this point.
    session.core.markDisplayed(ownerJid, 'chat', trigger.id);

    // The soft daily limit holds even when the marker above already went out:
    // a limited AI answers with at most one notice per day, and further
    // messages that day get no reply and no notice. The usage read also
    // decides the 80% warnings, which go out after the reply below.
    const dmChatKey = `dm:${ownerBare}`;
    const dmBudget = await checkDailyLimit({
      aiId: session.aiId,
      chatKey: dmChatKey,
      sendNotice: (text) => session.core.sendMessage(ownerJid, 'chat', text),
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
      });

      // `end` always comes after the final XMPP message: `runDmTurn` sends
      // it before resolving.
      const outcome = await runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        executeTool: executePersonaTool(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        onDelta: (textSoFar) => {
          turnDrafts.push(textSoFar);
        },
        beforeFinalSend: (text) => {
          turnDrafts.flush(text);
        },
        sendMessage: (to, kind, text) => session.core.sendMessage(to, kind, text),
        sendTyping: (to, kind, state) => {
          session.core.sendTyping(to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      turnDrafts.end(outcome.kind === 'replied' ? 'sent' : 'failed');
      // The 80% heads-ups go out after the reply, so the owner reads the
      // answer first. A failed warning send only logs and never fails the
      // turn.
      await sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: dmChatKey,
        usage: dmBudget.usage,
        sendWarning: (text) => session.core.sendMessage(ownerJid, 'chat', text),
      });
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI turn failed',
      );
      const reply = mapFailureToReply(error);
      try {
        await session.core.sendMessage(ownerJid, 'chat', reply);
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      // The failed `end` goes out only after the failure text was sent (or
      // its send was attempted): the contract promises `end` comes last.
      try {
        session.core.sendTyping(ownerJid, 'chat', 'paused');
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
        if (event.type === 'created') {
          void loadActiveAi(deps.db, event.aiId)
            .then((record) => {
              if (record !== null) {
                return connectAi(record);
              }
            })
            .catch((error: unknown) => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
                'AI post-create connect failed',
              );
            });
        } else {
          void disconnectAi(event.aiId).catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI post-delete disconnect failed',
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
  };
}
