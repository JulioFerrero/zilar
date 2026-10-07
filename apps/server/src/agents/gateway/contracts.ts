import type { Payload } from '@zilar/protocol';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { ActionGateway, DeniedReason } from '../../actions/gateway';
import { redactSecrets, type FetchLike, type LitellmAdminClient } from '../../ai/litellm-client';
import type { KeyCipher } from '../../connections/crypto';
import type { ServerDatabase } from '../../db/client';
import type { DraftHub } from '../../drafts/hub';
import type { ArchivePool } from '../../search/service';
import type { EjabberdAdminClient } from '../../xmpp/admin-client';
import type { XmppConfig } from '../../xmpp/config';
import type { completeChat } from '../reply';

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
  /** T-0475: the server-paid room listener (plan §2). Absent means the
   * listener is off, so a room message without an AI mention wakes nobody.
   * `quietMs` and `everyN` tune the debounce (defaults below). `complete`
   * is injected in tests. */
  listener?: {
    model: string;
    virtualKey: string;
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

export interface PendingMessage {
  id: string;
  body: string;
  fromJid: string;
}

export interface RoomPendingMessage {
  id: string;
  body: string;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  timestamp: Date;
  /** T-0479: set by a listener wake, never by a mention. */
  wake?: true;
  /** T-0481: set on an AI-to-AI handoff queued by another AI's @mention. */
  handoff?: true;
  /** T-0482: set on the synthetic trigger `delegate` queues on the worker's
   * session; its id is the delegation row to finish when the turn ends. */
  delegationId?: string;
}

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
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface AiSession {
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

export function isAiSender(bare: string): boolean {
  return (bare.split('@')[0] ?? '').startsWith('ai-');
}

export function retryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
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
