import { Effect } from 'effect';
import type { ChatSummary, MediaTokenShape, UiMessage } from '@zilar/chat-core';
import type { ConnectionStatus, XmppCore } from '@zilar/xmpp-core';
import { createMessageLedger } from './ledger';
import type { LedgerPatch, LedgerState, MessageLedger, MessageLedgerDeps } from './ledger';
import type { Lifetime } from './lifetime';
import type { CoreContact, CoreMe, CorePorts } from './ports';

export interface CoreTyping {
  names: string[];
  status?: string;
}

export interface CoreDraft {
  turnId: string;
  text: string;
}

export interface CoreActionError {
  chatId: string;
  message: string;
}

export interface CoreState extends LedgerState {
  readonly currentUserId: string;
  /** The open chat: `undefined` on web, `null` on mobile when none is open. */
  readonly activeChatId: string | null | undefined;
  readonly typing: Record<string, CoreTyping>;
  readonly drafts: Record<string, CoreDraft>;
  readonly finishedDraftMessages: Record<string, string>;
  readonly actionError?: CoreActionError | undefined;
}

export interface CorePatch extends LedgerPatch {
  typing?: Record<string, CoreTyping>;
  drafts?: Record<string, CoreDraft>;
  finishedDraftMessages?: Record<string, string>;
  actionError?: CoreActionError | undefined;
}

export type CoreSet = (update: CorePatch | ((state: CoreState) => CorePatch)) => void;

/**
 * App code the core calls that stays per app: badge and push notifications (web), group
 * members, draft turns and the bytes kept for a Retry. Each one returns at once.
 */
export interface CoreHooks {
  readonly syncBadge: () => void;
  readonly dismissChatNotifications: (chatId: string) => void;
  readonly loadGroupMembers: (chatId: string) => void;
  readonly finishDraftTurn: (chatId: string, turnId: string) => void;
  readonly forgetRetryBytes: (messageId: string) => void;
  /** Shows an in-tab browser notification for an unread message (web); mobile leaves it unset. */
  readonly notifyIncoming?: (chatId: string, message: UiMessage) => void;
  /**
   * The group rooms joined in this session, the same set as the context's `joinedRooms`;
   * the mobile history adapter rebuilds the context and reads it here.
   */
  readonly joinedRooms?: Set<string>;
}

export interface JoinGroupsHooks {
  /** A group chat to join before the rest: the chat the user is opening. */
  first?: string | undefined;
  onJoined?: ((chatId: string) => void) | undefined;
}

export interface BootInput {
  readonly me: CoreMe;
  readonly freshRows: ChatSummary[];
  readonly previousChats: ChatSummary[];
  /** True while the boot's user is the one whose list was painted on start. */
  readonly sameUser: boolean;
  readonly contacts: readonly CoreContact[];
  readonly prefs: readonly unknown[];
}

/** The app hooks the polling and lifecycle modules call; every one returns at once. */
export interface StoreAppHooks extends CoreHooks {
  readonly setStatus: (status: ConnectionStatus) => void;
  readonly prepareStart: () => void;
  readonly setChatsLoad: (load: 'loading' | 'ready' | 'error') => void;
  readonly applyBoot: (input: BootInput) => void;
  readonly rememberGroupIds: (entries: readonly unknown[]) => void;
  readonly scheduleChatsRefresh: () => void;
  readonly refreshChats: () => void;
  readonly refreshActiveChatPins: (chatId: string) => void;
  /** Joins new group rooms and loads their members; resolves once the joins are done,
   * so group history waits for them. `hooks.first` is joined first. */
  readonly joinGroups: (core: XmppCore, me: unknown, hooks?: JoinGroupsHooks) => Promise<void>;
  readonly saveChatList: () => void;
  readonly refreshDefaultBackground: () => void;
  /** Loads the app's chat folders at boot (mobile); web fetches them outside the store. */
  readonly loadFolders?: () => void;
  readonly setMediaTrustedHosts: (hosts: ReadonlySet<string> | undefined) => void;
  readonly applyStop: () => void;
}

export interface CoreCtx {
  readonly get: () => CoreState;
  readonly set: CoreSet;
  readonly ports: CorePorts;
  readonly rt: Lifetime<never>;
  readonly k: MessageLedger;
  readonly fx: CoreHooks;

  core: XmppCore | undefined;
  /**
   * The last connection status written to the app, kept here so the polling loops can
   * slow down while XMPP pushes changes live. Undefined before the first write.
   */
  connectionStatus?: ConnectionStatus | undefined;
  lastRead: Record<string, string>;
  lastReadUserId: string | undefined;
  readonly pendingOutgoing: Map<string, string[]>;
  /**
   * Texts waiting for their ack or their resend: memory only, one per store instance. The
   * lifecycle flushes it on online and `reset()` clears it on sign-out, so one user's queue
   * never goes out as another user.
   */
  outbox?: import('./send/outbox').TextOutbox | undefined;
}

/** The mutable locals both stores own and bridge onto their context. */
export interface CoreLocals {
  core: XmppCore | undefined;
  lastRead: Record<string, string>;
  cursors: Record<string, string | undefined>;
  pendingOutgoing: Map<string, string[]>;
  groupIds: Map<string, string>;
  loadingOlder: Set<string>;
  loadingHistory: Set<string>;
  pendingOpenChatId: string | undefined;
  groupsJoined: boolean;
  joinedRooms: Set<string>;
  mediaToken: MediaTokenShape | undefined;
}

export function createCoreLocals(): CoreLocals {
  return {
    core: undefined,
    lastRead: {},
    cursors: {},
    pendingOutgoing: new Map(),
    groupIds: new Map(),
    loadingOlder: new Set(),
    loadingHistory: new Set(),
    pendingOpenChatId: undefined,
    groupsJoined: false,
    joinedRooms: new Set(),
    mediaToken: undefined,
  };
}

export interface CoreLedgerDeps {
  readonly get: () => LedgerState;
  readonly set: MessageLedgerDeps['set'];
  readonly locals: CoreLocals;
  readonly memberName: MessageLedgerDeps['memberName'];
}

/** The ledger every store shares; `memberName` stays the app's own map shape. */
export function createCoreLedger({ get, set, locals, memberName }: CoreLedgerDeps): MessageLedger {
  return createMessageLedger({
    get,
    set,
    memberName,
    occupantNick: (chatId, fromJid) =>
      locals.core
        ?.occupants(chatId)
        .find((item) => item.realJid === fromJid || item.jid === fromJid)?.nick,
    mediaToken: () => locals.mediaToken,
  });
}

export const nickFor = (me: {
  readonly name: string;
  readonly jid?: string | null | undefined;
}): string => {
  const name = me.name.trim();
  if (name.length > 0) {
    return name;
  }
  return me.jid?.split('@')[0] ?? 'me';
};

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** The keys two objects share with the same type, so a bridge cannot widen one side. */
export type SharedLocalKeys<L extends object, C extends object> = {
  [K in keyof L & keyof C]: SameType<L[K] | undefined, C[K] | undefined> extends true ? K : never;
}[keyof L & keyof C];

/**
 * Defines a getter and a setter for each key, both reading and writing the local, so a
 * context field and its local never drift apart.
 */
export function bridgeLocals<L extends object, C extends object>(
  locals: L,
  ctx: C,
  keys: readonly SharedLocalKeys<L, C>[],
): void {
  for (const key of keys) {
    Object.defineProperty(ctx, key, {
      get: () => locals[key],
      set: (value: L[typeof key]) => {
        Reflect.set(locals, key, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
}

export const fromPromise = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: () => thunk(), catch: (error) => error });

/**
 * Writes the connection status to the app and remembers it on the ctx for the poll gate,
 * in one place.
 */
export function setConnectionStatus(
  ctx: CoreCtx & { readonly fx: StoreAppHooks },
  status: ConnectionStatus,
): void {
  ctx.connectionStatus = status;
  ctx.fx.setStatus(status);
}
