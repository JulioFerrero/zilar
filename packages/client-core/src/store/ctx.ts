// What the core's store modules share about one chat store: the state accessors,
// the ports, the lifetime, the message ledger, the app hooks, and the mutable
// bookkeeping the store keeps beside its state. Each app's own context extends
// this one, so an app module and a core module take the same value.
import { Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import type { ConnectionStatus, XmppCore } from '@zilar/xmpp-core';
import type { LedgerPatch, LedgerState, MessageLedger } from './ledger';
import type { Lifetime } from './lifetime';
import type { CoreContact, CoreMe, CorePorts } from './ports';

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
  /** An inline error under one chat, from a failed message or send action. */
  readonly actionError?: CoreActionError | undefined;
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

/** What the lifecycle hands the app to write into its own state on boot. */
export interface BootInput {
  readonly me: CoreMe;
  readonly freshRows: ChatSummary[];
  readonly previousChats: ChatSummary[];
  /** True while the boot's user is the one whose list was painted on start. */
  readonly sameUser: boolean;
  readonly contacts: readonly CoreContact[];
  readonly prefs: readonly unknown[];
}

/**
 * The app hooks the T8 polling and lifecycle modules call, beside `CoreHooks`.
 * Every one returns at once; the app forks the work itself (web does), so the
 * core never needs the app's own `Ports` service to run them.
 */
export interface StoreAppHooks extends CoreHooks {
  /** Writes the XMPP connection status into the app's state. */
  readonly setStatus: (status: ConnectionStatus) => void;
  /** Paints the cached chat list and arms `pagehide`, once per store (web). */
  readonly prepareStart: () => void;
  /** Shows the chat list as loading/ready/error (web `chatsState`, mobile `chatsLoad`). */
  readonly setChatsLoad: (load: 'loading' | 'ready' | 'error') => void;
  /** Writes the boot result into the app's state: me, chats, contacts, prefs. */
  readonly applyBoot: (input: BootInput) => void;
  /** Records the group id of every chat row (web Kernel). */
  readonly rememberGroupIds: (entries: readonly unknown[]) => void;
  /** Schedules the debounced chat-list refresh (web history). */
  readonly scheduleChatsRefresh: () => void;
  /** Re-fetches the chat list now (web history). */
  readonly refreshChats: () => void;
  /** Refreshes the open chat's pins now (web pins). */
  readonly refreshActiveChatPins: (chatId: string) => void;
  /** Joins new group rooms and loads their members (web groupMembers).
   * Resolves once the joins are done, so group history waits for them. */
  readonly joinGroups: (core: XmppCore, me: unknown) => Promise<void>;
  /** Saves the painted chat list to storage and syncs the badge (web reads). */
  readonly saveChatList: () => void;
  /** Loads the default chat background (web prefs), fire and forget. */
  readonly refreshDefaultBackground: () => void;
  /** Loads the app's chat folders into its state at boot (mobile), fire and
   * forget. Web fetches folders outside the store, so it leaves this unset. */
  readonly loadFolders?: () => void;
  /** Publishes the media hosts trusted from the latest XMPP token. */
  readonly setMediaTrustedHosts: (hosts: ReadonlySet<string> | undefined) => void;
  /** Clears the app's per-session state on `stop()` (web `sendRuns`, ...). */
  readonly applyStop: () => void;
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
