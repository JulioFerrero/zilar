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
import type { SetState } from '@zilar/client-core';
import type { ChatStoreState } from '../store';
import type { PortsShape } from './ports';
import type { Lifetime } from './runtime';

/** The message ledger plus the plain helpers effect modules call; removeFailedMessage also
 * drops the kept attachment bytes. */
export interface Kernel extends MessageLedger {
  rememberGroupIds(entries: ChatEntry[]): void;
  nick(me: Me): string;
}

export interface SendRun {
  readonly settled: Deferred.Deferred<void>;
}

export interface StoreCtx extends HistoryCtx {
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly ports: PortsShape;
  readonly rt: Lifetime;
  readonly k: Kernel;
  readonly fx: StoreAppHooks;

  /** True from start() until stop(): a second start() is a no-op. */
  started: boolean;
  /** The boot in flight, so stop() and a resume can reach it. */
  boot: LifecycleBoot | undefined;

  /** The token the latest session connected with, for the media allow-list. */
  mediaToken: MediaTokenShape | undefined;
  cachedUserId: string | undefined;
  connectRetryAttempt: number;
  connectRetryPending: boolean;

  /** The group id of every group or topic chat row seen so far. */
  readonly groupIds: Map<string, string>;
  /** Group-detail loads in flight, keyed by group id. */
  readonly loadingGroupMembers: Set<string>;
  readonly groupMembers: Map<string, Map<string, MentionMember>>;
  readonly groupInfos: Map<string, GroupDetail>;
  readonly messageAuthors: Map<string, EditAuthor>;
  readonly messageOriginIds: Map<string, string>;
  readonly messageBaseTexts: Map<string, string>;
  /** Turn ids whose draft is done, so a late draft is ignored (capped, oldest first). */
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
  /** Open chat ids whose next disappearance moves silently (a self-archive). */
  readonly quietArchiveIds: Set<string>;
  /** The counter behind the optimistic local-N ids. */
  sequence: number;
  /** An outgoing attachment's bytes, kept for a Retry after a failed upload. */
  readonly pendingAttachments: Map<string, File>;
  /** An outgoing voice recording's bytes, kept for a Retry after a failed send. */
  readonly pendingVoices: Map<string, { blob: Blob; waveform: number[] }>;
  /** The current send attempt of a message, by its alias root. */
  readonly sendRuns: Map<string, SendRun>;
}
