import { makeLifetime, type CoreCtx, type Lifetime, type SendRun } from '@zilar/client-core/store';
import { Context, Effect, Exit, Fiber, Scope } from 'effect';
import type { ChatSummary, EditAuthor, MessageStatus, ReplyRef, UiMessage } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';

import type { PickedFile } from '../../lib/attachment-ports';
import type { MediaTokenShape } from '../../lib/attachments';
import type { RecordedVoice } from '../../lib/voice';
import type { VoiceFailureReason } from '../../lib/voice-native';
import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import type { CustomGroupRole } from '../../lib/roles-api';
import type { ApproverRole, Topic, TopicRole } from '../../lib/topics-api';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../types';
import { Ports, type PortsShape } from './ports';

/** Lifts a Promise call into an Effect; a rejection keeps its reason as thrown. */
export const lift = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: thunk, catch: (error) => error });

/**
 * Runs `effect`, then `onFail` when it failed or threw. Interruption is not
 * a failure: an interrupted fiber never reaches the handler. This is the
 * `try { ... } catch { ... }` of an async function.
 */
export const recover = <A, B, E, R>(
  effect: Effect.Effect<A, E, R>,
  onFail: (error: unknown) => Effect.Effect<B, never, R>,
): Effect.Effect<A | B, never, R> =>
  effect.pipe(
    Effect.catch((error) => onFail(error)),
    Effect.catchDefect((defect) => onFail(defect)),
  );

/**
 * `catch (error) { cleanup; throw error; }`: runs `cleanup` after a failure or
 * a throw, then fails again with the same error, so the caller still sees it.
 */
export const failAfter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  cleanup: (error: unknown) => Effect.Effect<void, never, R>,
): Effect.Effect<A, unknown, R> =>
  effect.pipe(
    Effect.catch((error) => Effect.andThen(cleanup(error), Effect.fail<unknown>(error))),
    Effect.catchDefect((defect) => Effect.andThen(cleanup(defect), Effect.fail<unknown>(defect))),
  );

/** `catch {}`: the failure or throw is dropped and the result is `fallback`. */
export const orElse = <A, B, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: B,
): Effect.Effect<A | B, never, R> => recover(effect, () => Effect.succeed(fallback));

/** Runs `effect` as its own fiber at once and joins it: a sibling failing cannot cancel it. */
export const detached = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.forkDetach(effect, { startImmediately: true }), Fiber.join);

export const isClosed = (scope: Scope.Scope): boolean => scope.state._tag === 'Closed';

/** Registers `finalizer` to run, once and synchronously, when `scope` closes. */
export function onClose(scope: Scope.Scope, finalizer: () => void): void {
  Effect.runSync(Scope.addFinalizer(scope, Effect.sync(finalizer)));
}

/** Closes `scope` now: every fiber forked into it is interrupted, then its finalizers run. */
export function closeScope(scope: Scope.Closeable): void {
  Effect.runFork(Scope.close(scope, Exit.void));
}

/**
 * One lifetime replaces the old `generation` counter and the teardown lists.
 * The store Scope holds what only `stop()` ends: the AppState listener, the
 * XMPP event subscriptions, the draft stream. A "generation" is the core
 * lifetime's current session (the core owns both, T-0918); a boot retry ends
 * it. Closing a scope interrupts every fiber forked into it.
 */
export interface Life {
  /** The core lifetime underneath: the `rt` of the core modules (`CoreCtx`). */
  readonly lifetime: Lifetime<never>;
  /** The store Scope, opened on first use: what `stop()` closes. */
  session(): Scope.Closeable;
  /** The current session Scope, opened on first use. */
  generation(): Scope.Scope;
  /** Ends the current session and opens the next one. */
  restartGeneration(): void;
  /** Closes the store Scope; the next use opens fresh scopes. */
  endSession(): void;
  /** Starts `task` now under `key` in the store; a task with the same key is interrupted first. */
  forkKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  /** Like `forkKeyed`, but a task with the same key ends with the session. */
  forkGenerationKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  /** Interrupts the store task with this key, if any. */
  cancel(key: string): void;
  /** Interrupts the session task with this key, if any. */
  cancelGeneration(key: string): void;
}

/**
 * An adapter over the core lifetime: the session is its store Scope and a
 * "generation" is its current session. Nothing is created at construction, so
 * the core's `start()` owns the first session and a fork before it lands in
 * the store Scope.
 */
export function makeLife(): Life {
  const lifetime = makeLifetime(Context.empty());
  const currentSession = (): ReturnType<Lifetime<never>['beginSession']> =>
    lifetime.session() ?? lifetime.beginSession();
  return {
    lifetime,
    session: () => lifetime.storeScope(),
    generation: () => currentSession().scope,
    restartGeneration: () => {
      lifetime.beginSession();
    },
    endSession: () => lifetime.closeStore(),
    forkKeyed: lifetime.forkKeyed,
    forkGenerationKeyed: (key, task) => currentSession().forkKeyed(key, task),
    cancel: lifetime.cancel,
    cancelGeneration: (key) => {
      lifetime.session()?.cancel(key);
    },
  };
}

/** The mutable state the effect modules share with the closure in `real-store.ts`. */
export interface StoreState {
  core: XmppCore | undefined;
  started: boolean;
  firstToken: { jid: string; token: string } | undefined;
  /** The boot in flight, one per generation, so a resume can wait for it. */
  boot: { scope: Scope.Scope; fiber: Fiber.Fiber<void> | undefined } | undefined;
  groupsJoined: boolean;
  pendingOpenChatId: string | undefined;
  mediaToken: MediaTokenShape | undefined;
  mediaTrustedHosts: ReadonlySet<string>;
  lastRead: Record<string, string>;
  chatPrefRows: ChatPref[];
  /** The archive cursor to page before, by chat id. */
  readonly cursors: Record<string, string | undefined>;
  /** Turn ids whose draft is done, so a late `draft` is ignored (T-0918). */
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
  /** First-page history loads in flight, by chat id (T-0067). */
  readonly loadingHistory: Set<string>;
  readonly loadingOlder: Set<string>;
  /** Chat id (topic rows too) -> group id. */
  readonly groupIds: Map<string, string>;
  /** Optimistic ids waiting for their server echo, by message signature. */
  readonly pendingOutgoing: Map<string, string[]>;
  /** The counter behind the optimistic `local-N` ids (T10). */
  sequence: number;
  /** The current send attempt of a message, by its alias root (T10). */
  readonly sendRuns: Map<string, SendRun>;
  /** The local bytes of an outgoing attachment, kept for a Retry. */
  readonly pendingUploads: Map<string, PickedFile>;
  /** A finished voice recording per optimistic message, kept for a Retry. */
  readonly pendingVoices: Map<string, RecordedVoice>;
  /** Group id -> the group detail (people + roles + AIs). */
  readonly groupDetails: Map<string, GroupDetail>;
  readonly loadingGroupDetails: Set<string>;
  /** Group id -> the custom roles (T-0137). */
  readonly groupRolesById: Map<string, CustomGroupRole[]>;
  readonly loadingGroupRoles: Set<string>;
  /** Topic id -> the attached roles + approver role (T-0137). */
  readonly topicRolesById: Map<string, { roles: TopicRole[]; approverRole: ApproverRole | null }>;
  readonly loadingTopicRoles: Set<string>;
  /** Chat id -> (lowercased user id -> display name). */
  readonly groupMembers: Map<string, Map<string, string>>;
}

/** The plain helpers of `real-store.ts` the effect modules call. */
export interface StoreHelpers {
  sortByRecency(chats: ChatSummary[]): ChatSummary[];
  summariesFor(entry: ChatEntry): ChatSummary[];
  rememberGroupIds(entries: ChatEntry[]): void;
  nick(me: Me): string;
  coreKind(chat: ChatSummary): 'chat' | 'groupchat';
  isReactionOnly(message: ChatMessage): boolean;
  isEditStanza(message: ChatMessage): boolean;
  sortMessages(messages: UiMessage[]): UiMessage[];
  ingestHistoryReactions(messages: readonly ChatMessage[]): void;
  ingestHistoryEdits(messages: readonly ChatMessage[]): void;
  toUiMessage(message: ChatMessage, meId: string): UiMessage;
  resolvePendingEdits(chatId: string): void;
  withEdits(message: UiMessage, chatId: string): UiMessage;
  previewFor(message: UiMessage): UiMessage;
  refreshEdits(chatId: string): void;
  recordRead(chatId: string, messageId: string | undefined): void;
  sameMessage(left: string, right: string): boolean;
  listFor(state: ChatStoreState, chatId: string): UiMessage[];
  groupIdForChat(chatId: string): string | undefined;
  rememberTopicRoles(topic: Topic): void;
  rememberMembers(chatId: string, detail: GroupDetail): void;
  myJid(): string | undefined;
  aliasRoot(id: string): string;
  rememberAuthor(messageId: string, author: EditAuthor): void;
  rememberOriginId(messageId: string, originId: string): void;
  linkMessageIds(left: string, right: string): void;
  /** Links a send's ack id to its optimistic id (the ledger's `linkAckToServer`). */
  linkAckToServer(chat: ChatSummary, localId: string, serverId: string): void;
  updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): void;
  signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string;
  stickerSignatureFor(
    chatId: string,
    body: string,
    stickerId: string,
    replyTo: ReplyRef | undefined,
  ): string;
  setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void;
  markStickerFailed(chatId: string, messageId: string): void;
  markAttachmentFailed(chatId: string, messageId: string): void;
  markVoiceFailed(chatId: string, messageId: string, reason?: VoiceFailureReason): void;
  clearFailure(message: UiMessage): UiMessage;
  clearAttachmentFailure(chatId: string, messageId: string): void;
  updateMessageAttachment(chatId: string, messageId: string, attachment: Attachment): void;
  updateMessageVoice(
    chatId: string,
    messageId: string,
    voice: { duration_ms: number; mime: string; waveform: number[]; url: string },
  ): void;
  /** Ends what `stop()` clears besides the core scopes: timers, caches, per-session maps. */
  teardown(): void;
}

/** Effects of one concern that another concern calls. Filled in by `real-store.ts`. */
export interface StoreFx {
  loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  loadFolders: Effect.Effect<void, never, Ports>;
  refreshChats: Effect.Effect<void, never, Ports>;
  loadPins(chatId: string, loud: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupMembers(chatId: string): Effect.Effect<void, never, Ports>;
  /** Debounces a chat-list refresh (a roster push or a group invitation). */
  scheduleChatsRefresh(): void;
  startPinsPolling(chatId: string): void;
  /** Refreshes the open chat's pins now, when its poll is running. */
  refreshActiveChatPins(chatId: string): void;
  restartBoot(): void;
  joinGroups(current: XmppCore, me: Me): Effect.Effect<void, never, Ports>;
  loadPreview(current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports>;
}

/** What every effect module is built from. */
export interface StoreCtx {
  readonly ports: PortsShape;
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly s: StoreState;
  readonly life: Life;
  readonly h: StoreHelpers;
  readonly fx: StoreFx;
  /**
   * The same store as the core modules see it (`@zilar/client-core/store`):
   * the incoming handlers, the message actions and the reads run on it.
   */
  readonly coreCtx: CoreCtx;
  /** Starts `effect` at once as a fiber of `scope` (default: the current generation). */
  fork<A, E>(effect: Effect.Effect<A, E, Ports>, scope?: Scope.Scope): Fiber.Fiber<A, E>;
  /**
   * Starts `effect` at once as a fiber of the session: background work that
   * survives a restart of the boot but not `stop()`.
   */
  forkSession<A, E>(effect: Effect.Effect<A, E, Ports>): Fiber.Fiber<A, E>;
  /** Runs `effect` as a plain Promise (an action's edge). */
  run<A, E>(effect: Effect.Effect<A, E, Ports>): Promise<A>;
}

export function makeRunners(
  ports: PortsShape,
  life: Life,
): Pick<StoreCtx, 'fork' | 'forkSession' | 'run'> {
  const fork = <A, E>(
    effect: Effect.Effect<A, E, Ports>,
    scope: Scope.Scope = life.generation(),
  ): Fiber.Fiber<A, E> =>
    Effect.runSync(
      Effect.forkIn(Effect.provideService(effect, Ports, ports), scope, {
        startImmediately: true,
      }),
    );
  return {
    fork,
    forkSession: (effect) => fork(effect, life.session()),
    run: (effect) => Effect.runPromise(Effect.provideService(effect, Ports, ports)),
  };
}
