import { Effect, type Fiber } from 'effect';
import type { Payload } from '@zilar/protocol';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { ActionGateway, DeniedReason } from '../../actions/gateway';
import { redactSecrets, type FetchLike } from '../../ai/http';
import type { ModelTarget } from '../../ai/providers';
import type { KeyCipher } from '../../connections/crypto';
import type { ServerDatabase } from '../../db/client';
import type { DraftHub } from '../../drafts/hub';
import type { ArchivePool } from '../../search/service';
import type { EjabberdAdminClient } from '../../xmpp/admin-client';
import type { XmppConfig } from '../../xmpp/config';
import type { completeChat } from '../reply';
import type { RunnerDeskSource } from '../../hands/resolve';
import type { DeskClient } from './desk-exec';
import type { PendingMessage, RoomPendingMessage, ScheduledRunOutcome } from './pending';

// T-1647: the queue item types and the scheduled-run outcome live in
// `pending.ts` to keep this file under the 400-line cap. Re-exported here so
// every existing import of these names keeps working.
export type {
  PendingMessage,
  RoomPendingMessage,
  ScheduledRunOutcome,
  ScheduledTurnOutcome,
} from './pending';

export interface GatewayLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  /** T-1633: an optional low-volume trace line. The pure test logger only
   * implements info/warn, so callers use `logger.debug?.(…)`. */
  debug?: (fields: Record<string, unknown>, message: string) => void;
}

export interface AgentGatewayDeps {
  db: ServerDatabase;
  xmpp: XmppConfig;
  adminClient: EjabberdAdminClient;
  /** Absent when the key master key is not configured: the gateway stays off. */
  cipher?: KeyCipher;
  logger: GatewayLogger;
  /** T-0156: counts logger for the tool-turn counts line (rounds, tool
   * calls, ms — ids and counts only, never content). Falls back to
   * `logger` so production keeps the line the T-0106 review deferred. */
  turnLogger?: GatewayLogger;
  /** T-0475: the server-paid room listener (plan §2). Absent means the
   * listener is off, so a room message without an AI mention wakes nobody.
   * T-1399: the listener is off in P0 (no platform key), so production never
   * sets this; the type stays so the listener still compiles. `quietMs` and
   * `everyN` tune the debounce (defaults below). `complete` is injected in
   * tests. */
  listener?: {
    target: ModelTarget;
    quietMs?: number;
    everyN?: number;
    complete?: typeof completeChat;
  };
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
  /** T-1409: the cloud desk client (Hands plus the pinned image). T-1603: a
   * cached probe, read once per turn; a not-ready agent means no cloud desk for
   * that turn. A turn offers the desk tools only for an AI whose
   * `computer_mode` is `cloud`. */
  desk?: () => Promise<DeskClient | null>;
  /** T-1423: the runner hub's desk ops, read lazily per turn (the hub starts
   * after the gateway is built). Absent or returning null keeps `runner` and
   * `auto` unavailable. */
  runnerDesk?: () => RunnerDeskSource | null;
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

// T-1168 (AI-1): on shutdown the gateway drains before it disconnects. It
// refuses new turns, waits up to `AI_DRAIN_MS` (polling every
// `AI_DRAIN_POLL_MS`) for every DM and room turn in flight to finish and send,
// and tells the asker `AI_RESTART_REPLY` for a turn still running at the
// deadline. Must finish well inside Docker's 10 s SIGTERM kill (`main.ts`
// FORCE_EXIT_MS is 15 s).
export const AI_DRAIN_MS = 8_000;
export const AI_DRAIN_POLL_MS = 200;

// T-1168: the fixed text a turn still running at the drain deadline sends
// through its still-connected session, so the asker learns the reply was lost
// to a restart instead of seeing nothing.
export const AI_RESTART_REPLY = 'I was restarted in the middle of my reply. Please ask again.';

// Fresh-token TTL for each AI login. xmpp-core asks `getToken` on every
// (re)connect, so no connection ever runs on a stale token.
export const XMPP_TOKEN_TTL_SECONDS = 300;

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

// T-0479: at most this many AI turns per human room message, across every AI
// in the room. A new human message opens a fresh round.
export const ROUND_MAX_AI_TURNS = 4;

// T-0481: at most this many AI-to-AI handoffs per human room message. A
// handoff turn counts against ROUND_MAX_AI_TURNS too.
export const ROUND_MAX_HOPS = 2;

// A live room message carries ~now as its timestamp, while history replayed
// on join carries its original (older) stamp. Anything older than the join
// minus this skew is treated as replayed history and never wakes the AI.
export const GROUP_JOIN_SKEW_MS = 60_000;

// T-0475: the listener scores a room after this much quiet, or early once this
// many human messages have queued without a mention (plan §2.1).
export const LISTENER_QUIET_MS_DEFAULT = 20_000;
export const LISTENER_EVERY_N_DEFAULT = 12;

// T-0479: the per-room round budget, shared by every AI session in the room
// and keyed by the human message that opened it.
export interface RoomRound {
  humanMessageId: string;
  aiTurns: number;
  /** T-0481: AI-to-AI hops already spent in this round. */
  hops: number;
  /** T-0481: AI message ids already counted, so several sessions seeing the
   * same stanza spend one hop. */
  handoffIds: Set<string>;
}

export interface RoomSubscription {
  groupId: string;
  /** The topic this room belongs to. Set for every room subscription. */
  topicId: string;
  joinedAtMs: number;
  nick: string;
  /** T-1633: when this AI's own room message reflected back, for rule R. */
  lastOwnReplyAtMs?: number;
  /** T-1633: when another AI's message arrived in the room, for rule R. */
  lastOtherAiAtMs?: number;
}

// T-0475: one debounce window per room, at the gateway level, shared by every
// AI session in it. `seen` dedupes the stanza each session receives; `count`
// is the messages since the last check and `generation` invalidates a scoring
// call whose window a newer human message replaced.
interface RoomListenerMessage {
  id: string;
  sender: string;
  text: string;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  timestamp: Date;
}

export interface RoomListenerState {
  groupId: string;
  topicId: string;
  window: RoomListenerMessage[];
  seen: Set<string>;
  count: number;
  generation: number;
  inFlight: boolean;
  /** The pending debounce: a fiber that sleeps, then fires the check. */
  timer: Fiber.Fiber<void> | undefined;
}

export interface AiSession {
  aiId: string;
  aiJid: string;
  core: XmppCore;
  busy: boolean;
  pending: PendingMessage[];
  stopped: boolean;
  retryAttempt: number;
  /** The pending reconnect: a fiber that sleeps, then reconnects. */
  retryTimer: Fiber.Fiber<void> | undefined;
  unsubs: Array<() => void>;
  /** T-1422: the AbortController of the turn running in each chat, keyed by
   * the client chat id the owner sees (the AI's own JID in a DM, the room JID
   * in a group/topic). One entry per running turn. */
  turnAborts: Map<string, AbortController>;
  /** Rooms the AI currently holds a join for, keyed by bare room JID. */
  rooms: Map<string, RoomSubscription>;
  /** One coalescing queue per room, like the DM queue. */
  roomPending: Map<string, RoomPendingMessage[]>;
  /** Rooms with a turn in flight. */
  roomBusy: Set<string>;
  /** Turn timestamps (ms) per room for the rate limit. */
  roomTurns: Map<string, number[]>;
  /** T-1176 (AI-7): ms stamp of the last rate-limit notice per room, so a
   * drop inside the same window stays silent. In memory only. */
  roomRateNotices: Map<string, number>;
  /** T-1176 (AI-8): ids of the messages this AI last sent per room, newest
   * last and bounded. Zilar's own clients send no `to` on a reply, so a human
   * reply quoting one of these ids wakes the AI. In memory only. */
  roomSentIds: Map<string, string[]>;
}

// T-1176 (AI-8): how many sent message ids are kept per room. The rate limit
// already bounds how often an AI posts, so a small window is enough.
export const ROOM_SENT_ID_LIMIT = 40;

// T-1176 (AI-8): records the id of a message this AI just sent in a room,
// keeping only the newest `ROOM_SENT_ID_LIMIT` ids.
export function rememberRoomSentId(session: AiSession, roomJid: string, id: string): void {
  if (id === '') {
    return;
  }
  const ids = session.roomSentIds.get(roomJid) ?? [];
  ids.push(id);
  if (ids.length > ROOM_SENT_ID_LIMIT) {
    ids.shift();
  }
  session.roomSentIds.set(roomJid, ids);
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
  /**
   * T-1422: aborts the turn running in one chat, if any. `chatJid` is the
   * client chat id the owner sees (the AI's own JID in a DM, the room JID in a
   * group/topic). Returns `true` when a turn was running and was aborted,
   * `false` when the AI is unknown or idle. Owner scoping happens in the
   * route; this only reaches the gateway's own sessions.
   */
  stopTurn: (aiId: string, chatJid: string) => boolean;
  /**
   * T-1647 (plan §2.2): the routine scheduler's port, never reached from the
   * network. Queues a routine's synthetic trigger on the AI's own DM or room
   * queue — the same queue a live turn uses, so it never overlaps one — and
   * resolves with the turn's outcome: `replied`, `failed`, `stopped`,
   * `limited`, `offline`, or `not_in_room` when a room routine's room does not
   * exist or the AI's session has not joined it. A turn that never settles
   * resolves `failed` after the runner's timeout.
   */
  runScheduledTurn: (input: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    routineId: string;
    title: string;
    prompt: string;
  }) => Promise<ScheduledRunOutcome>;
  /**
   * T-1709: after a person decides an approval, the approvals route queues a
   * follow-up turn on the AI's own DM or room queue so it continues the task
   * it stopped at. An approve queues one turn, from the person who decided; a
   * deny, a still-open request or a stopped/offline AI queues nothing.
   */
  continueAfterApproval: (approvalId: string) => Promise<void>;
}

export function isAiSender(bare: string): boolean {
  return (bare.split('@')[0] ?? '').startsWith('ai-');
}

export function retryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}

// Interrupting the fiber cancels its sleep synchronously, like `clearTimeout`;
// it is a no-op for a timer that already fired.
export function cancelTimer(timer: Fiber.Fiber<void> | undefined): void {
  timer?.interruptUnsafe();
}

// A Promise-returning call as an Effect. A rejection (or a synchronous throw)
// arrives in the error channel as the very value that was thrown.
export function attempt<A>(thunk: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: thunk, catch: (error) => error });
}

export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

// The model-facing wording for a `denied` outcome. We never echo the
// adapter's reason beyond the stable enum: only `unknown_action`,
// `invalid_args`, `ai_not_active`, and `ai_not_in_group` (T-0090).
export function denialReasonForModel(reason: DeniedReason): string {
  switch (reason) {
    case 'unknown_action':
      return 'unknown action';
    case 'invalid_args':
      return 'invalid arguments; use the Args shown for this action';
    case 'ai_not_active':
      return 'the AI is not active';
    case 'ai_not_in_group':
      return 'the AI is not in that topic';
    case 'needs_approval':
      return 'this action needs a person to approve it, which a scheduled run cannot ask for; do the job another way or say in your answer what needs approval';
  }
}

// Appends an adapter's `modelText` to an executed outcome as a labelled
// untrusted block (T-0105): the model's only way to read a tool's source
// or a test run's output. `undefined` (the adapter returned none) appends
// nothing. Tool output is data, never instructions: the wrapper names it
// as untrusted so the model treats it accordingly.
export function formatModelText(modelText: string | undefined): string {
  if (modelText === undefined) {
    return '';
  }
  return `\n\n<untrusted-tool-output>\n${modelText}\n</untrusted-tool-output>`;
}

export function toRedactedError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSecrets(error.message, secrets));
    redacted.name = error.name;
    redacted.stack = redactSecrets(error.stack ?? '', secrets);
    return redacted;
  }
  return new Error(redactSecrets(String(error), secrets));
}
