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
import type { EjabberdAdminClient } from '../../xmpp/admin/types';
import type { completeChat } from '../dm-turn';
import type { XmppConfig } from '../../xmpp/config';
import type { RunnerDeskSource } from '../../hands/resolve';
import type { DeskClient } from './desk-exec';
import type { PendingMessage, RoomPendingMessage, ScheduledRunOutcome } from './pending';

export type {
  PendingMessage,
  RoomPendingMessage,
  ScheduledRunOutcome,
  ScheduledTurnOutcome,
} from './pending';

export interface GatewayLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  debug?: (fields: Record<string, unknown>, message: string) => void;
}

export interface AgentGatewayDeps {
  db: ServerDatabase;
  xmpp: XmppConfig;
  adminClient: EjabberdAdminClient;
  /** Absent when the key master key is not configured: the gateway stays off. */
  cipher?: KeyCipher;
  logger: GatewayLogger;
  turnLogger?: GatewayLogger;
  listener?: {
    target: ModelTarget;
    quietMs?: number;
    everyN?: number;
    complete?: typeof completeChat;
  };
  createCore?: (options: XmppCoreOptions) => XmppCore;
  fetchImpl?: FetchLike;
  now?: () => Date;
  drafts?: { hub?: DraftHub };
  actions?: ActionGateway;
  toolsEnabled?: boolean;
  toolMaxRounds?: number;
  /** Memory archive. Absent means memory is read but never indexed. */
  archive?: ArchivePool;
  desk?: () => Promise<DeskClient | null>;
  runnerDesk?: () => RunnerDeskSource | null;
  cardMediaDir?: string;
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

export const AI_DRAIN_MS = 8_000;
export const AI_DRAIN_POLL_MS = 200;

export const AI_RESTART_REPLY = 'I was restarted in the middle of my reply. Please ask again.';

export const XMPP_TOKEN_TTL_SECONDS = 300;

export const GATEWAY_RESOURCE = 'gateway';

// Privacy and cost rules for groups: any human member may trigger an AI by
// @mentioning it, and the owner pays under the AI's capped virtual key. Every
// log line below carries ids only, never bodies, names or keys.

// Per AI per room: at most this many turns in the sliding window below. The
// rest are dropped with one log line.
export const GROUP_TURNS_PER_WINDOW = 6;
export const GROUP_RATE_WINDOW_MS = 10 * 60_000;

export const ROUND_MAX_AI_TURNS = 4;

export const ROUND_MAX_HOPS = 2;

// A live room message carries ~now as its timestamp, while history replayed
// on join carries its original (older) stamp. Anything older than the join
// minus this skew is treated as replayed history and never wakes the AI.
export const GROUP_JOIN_SKEW_MS = 60_000;

export const LISTENER_QUIET_MS_DEFAULT = 20_000;
export const LISTENER_EVERY_N_DEFAULT = 12;

export interface RoomRound {
  humanMessageId: string;
  aiTurns: number;
  hops: number;
  handoffIds: Set<string>;
}

export interface RoomSubscription {
  groupId: string;
  /** The topic this room belongs to. Set for every room subscription. */
  topicId: string;
  joinedAtMs: number;
  nick: string;
  lastOwnReplyAtMs?: number;
  lastOtherAiAtMs?: number;
}

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
  turnAborts: Map<string, AbortController>;
  rooms: Map<string, RoomSubscription>;
  roomPending: Map<string, RoomPendingMessage[]>;
  roomBusy: Set<string>;
  /** Turn timestamps (ms) per room for the rate limit. */
  roomTurns: Map<string, number[]>;
  roomRateNotices: Map<string, number>;
  /** Ids of the messages this AI last sent per room, newest last and bounded.
   * Zilar's own clients send no `to` on a reply, so a human reply quoting one
   * of these ids wakes the AI. */
  roomSentIds: Map<string, string[]>;
}

export const ROOM_SENT_ID_LIMIT = 40;

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
  postToChat: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  correctInRoom: (input: {
    aiId: string;
    roomJid: string;
    originalId: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  stopTurn: (aiId: string, chatJid: string) => boolean;
  runScheduledTurn: (input: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    routineId: string;
    title: string;
    prompt: string;
  }) => Promise<ScheduledRunOutcome>;
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
// adapter's reason beyond the stable enum below.
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

// Appends an adapter's `modelText` as a labelled untrusted block: tool output
// is data, never instructions, so the model treats it accordingly.
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
