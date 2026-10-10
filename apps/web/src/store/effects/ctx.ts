// What the effect modules share about one chat store: the state accessors, the
// ports, the lifetime, the mutable bookkeeping the store keeps beside its
// state, and the plain helpers (`k`) that stay in `realStore.ts`. It extends
// the core context (`@zilar/client-core/store`), so web modules and core
// modules take the same value.
import type { EditAuthor, MentionMember } from '@zilar/chat-core';
import type {
  HistoryCtx,
  LifecycleBoot,
  MessageLedger,
  StoreAppHooks,
} from '@zilar/client-core/store';
import type { Deferred } from 'effect';
import type { ChatEntry, GroupDetail, Me } from '@/lib/api';
import type { MediaTokenShape } from '@/lib/attachments';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../store';
import type { PortsShape } from './ports';
import type { Lifetime } from './runtime';

/**
 * The message ledger (`@zilar/client-core/store`) plus the plain helpers of
 * `realStore.ts` that effect modules call. `removeFailedMessage` also drops
 * the kept attachment bytes.
 */
export interface Kernel extends MessageLedger {
  rememberGroupIds(entries: ChatEntry[]): void;
  nick(me: Me): string;
}

/** One send attempt of a message; `settled` completes when the attempt is over. */
export interface SendRun {
  readonly settled: Deferred.Deferred<void>;
}

/**
 * The core context (with history's bookkeeping) with web's state, ports and
 * lifetime, plus web's bookkeeping.
 */
export interface StoreCtx extends HistoryCtx {
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly ports: PortsShape;
  readonly rt: Lifetime;
  readonly k: Kernel;
  /** The app hooks the core polling and lifecycle call (T-0915). */
  readonly fx: StoreAppHooks;

  /** True from `start()` until `stop()`: a second `start()` is a no-op (R9). */
  started: boolean;
  /** The boot in flight, so `stop()` and a resume can reach it (T-0915). */
  boot: LifecycleBoot | undefined;

  /** The token the latest session connected with, for the media allow-list. */
  mediaToken: MediaTokenShape | undefined;
  /** The user whose cached chat list was painted on start, if any. */
  cachedUserId: string | undefined;
  connectRetryAttempt: number;
  connectRetryPending: boolean;

  /** The group id of every group or topic chat row seen so far. */
  readonly groupIds: Map<string, string>;
  /** Group-detail loads in flight, keyed by group id (T-0920). */
  readonly loadingGroupMembers: Set<string>;
  readonly groupMembers: Map<string, Map<string, MentionMember>>;
  readonly groupInfos: Map<string, GroupDetail>;
  readonly messageAuthors: Map<string, EditAuthor>;
  readonly messageOriginIds: Map<string, string>;
  readonly messageBaseTexts: Map<string, string>;
  /** Turn ids whose draft is done, so a late `draft` is ignored (capped, oldest first). */
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
  /** Open chat ids whose next disappearance moves silently (a self-archive). */
  readonly quietArchiveIds: Set<string>;
  /** The counter behind the optimistic `local-N` ids. */
  sequence: number;
  /** An outgoing attachment's bytes, kept for a Retry after a failed upload. */
  readonly pendingAttachments: Map<string, File>;
  /** An outgoing voice recording's bytes, kept for a Retry after a failed send. */
  readonly pendingVoices: Map<string, { blob: Blob; waveform: number[] }>;
  /** The current send attempt of a message, by its alias root. */
  readonly sendRuns: Map<string, SendRun>;
}
