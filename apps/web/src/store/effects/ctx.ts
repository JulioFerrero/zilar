// What the effect modules share about one chat store: the state accessors, the
// ports, the lifetime, the mutable bookkeeping the store keeps beside its
// state, and the plain helpers (`k`) that stay in `realStore.ts`.
import type { EditAuthor, MentionMember } from '@zilar/chat-core';
import type { MessageLedger } from '@zilar/client-core/store';
import type { Deferred } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
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

export interface StoreCtx {
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly ports: PortsShape;
  readonly rt: Lifetime;
  readonly k: Kernel;

  /** The connected XMPP core of the current session. */
  core: XmppCore | undefined;
  /** Group history (MUC MAM) only works once the rooms are joined. */
  groupsJoined: boolean;
  /** The latest chat opened before the core or the chats were ready. */
  pendingOpenChatId: string | undefined;
  /** The token the latest session connected with, for the media allow-list. */
  mediaToken: MediaTokenShape | undefined;
  lastRead: Record<string, string>;
  lastReadUserId: string | undefined;
  /** The user whose cached chat list was painted on start, if any. */
  cachedUserId: string | undefined;
  connectRetryAttempt: number;
  connectRetryPending: boolean;

  /** The group id of every group or topic chat row seen so far. */
  readonly groupIds: Map<string, string>;
  /** Group member loads in flight, by chat id. */
  readonly loadingGroupMembers: Set<string>;
  readonly groupMembers: Map<string, Map<string, MentionMember>>;
  readonly groupInfos: Map<string, GroupDetail>;
  readonly messageAuthors: Map<string, EditAuthor>;
  readonly messageOriginIds: Map<string, string>;
  readonly messageBaseTexts: Map<string, string>;
  /** Turn ids whose draft is done, so a late `draft` is ignored (capped, oldest first). */
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
  /** The oldest loaded message id per chat: where the next older page starts. */
  readonly cursors: Record<string, string | undefined>;
  /** First-page history loads in flight, by chat id. */
  readonly loadingHistory: Set<string>;
  /** Older-page loads in flight, by chat id. */
  readonly loadingOlder: Set<string>;
  /** Open chat ids whose next disappearance moves silently (a self-archive). */
  readonly quietArchiveIds: Set<string>;
  /** The counter behind the optimistic `local-N` ids. */
  sequence: number;
  /** Optimistic ids waiting for their server echo, by echo signature. */
  readonly pendingOutgoing: Map<string, string[]>;
  /** An outgoing attachment's bytes, kept for a Retry after a failed upload. */
  readonly pendingAttachments: Map<string, File>;
  /** An outgoing voice recording's bytes, kept for a Retry after a failed send. */
  readonly pendingVoices: Map<string, { blob: Blob; waveform: number[] }>;
  /** The current send attempt of a message, by its alias root. */
  readonly sendRuns: Map<string, SendRun>;
}
