// What the core's store modules share about one chat store: the state accessors,
// the ports, the lifetime, the message ledger, the app hooks, and the mutable
// bookkeeping the store keeps beside its state. Each app's own context extends
// this one, so an app module and a core module take the same value.
import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import type { LedgerPatch, LedgerState, MessageLedger } from './ledger';
import type { Lifetime } from './lifetime';
import type { CorePorts } from './ports';

/** The people typing in one chat. */
export interface CoreTyping {
  names: string[];
}

/** The live AI draft of one chat: the latest cumulative reply text. */
export interface CoreDraft {
  turnId: string;
  text: string;
}

/** An inline error under one chat, from a failed message action. */
export interface CoreActionError {
  chatId: string;
  message: string;
}

/** The part of a store's state the core reads; both apps' states satisfy it. */
export interface CoreState extends LedgerState {
  readonly currentUserId: string;
  /** The open chat: `undefined` on web, `null` on mobile when none is open. */
  readonly activeChatId: string | null | undefined;
  readonly typing: Record<string, CoreTyping>;
  readonly drafts: Record<string, CoreDraft>;
  readonly finishedDraftMessages: Record<string, string>;
}

/** The part of a store's state the core writes. */
export interface CorePatch extends LedgerPatch {
  typing?: Record<string, CoreTyping>;
  drafts?: Record<string, CoreDraft>;
  finishedDraftMessages?: Record<string, string>;
  actionError?: CoreActionError | undefined;
}

export type CoreSet = (update: CorePatch | ((state: CoreState) => CorePatch)) => void;

/**
 * App code the core calls and that stays per app until a later task moves it:
 * the badge and push notifications (web only), group members (phase 2), draft
 * turns (T8) and the bytes kept for a Retry (T10). Each one returns at once.
 */
export interface CoreHooks {
  /** Re-syncs the app badge from the current chats, in the background. */
  readonly syncBadge: () => void;
  /** Dismisses the chat's push notifications, in the background. */
  readonly dismissChatNotifications: (chatId: string) => void;
  /** Starts loading the members of a group chat, once per chat. */
  readonly loadGroupMembers: (chatId: string) => void;
  /** The AI's final message arrived: remember its turn, stop the chat's draft timer. */
  readonly finishDraftTurn: (chatId: string, turnId: string) => void;
  /** Drops the bytes kept for a Retry of this message id, if any. */
  readonly forgetRetryBytes: (messageId: string) => void;
}

export interface CoreCtx {
  readonly get: () => CoreState;
  readonly set: CoreSet;
  readonly ports: CorePorts;
  readonly rt: Lifetime<never>;
  readonly k: MessageLedger;
  readonly fx: CoreHooks;

  /** The connected XMPP core of the current session. */
  core: XmppCore | undefined;
  /** The last message read in each chat, by chat id. */
  lastRead: Record<string, string>;
  /** The user whose last-read map is loaded, and saved under their key. */
  lastReadUserId: string | undefined;
  /** Optimistic ids waiting for their server echo, by echo signature. */
  readonly pendingOutgoing: Map<string, string[]>;
}

/** One Promise call as an Effect; a rejection (or a sync throw) keeps its value as the failure. */
export const fromPromise = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: () => thunk(), catch: (error) => error });
