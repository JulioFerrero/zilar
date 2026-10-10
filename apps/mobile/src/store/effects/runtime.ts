import { makeLifetime } from '@zilar/client-core/store';
import { Context, Effect, Exit, Fiber, Scope } from 'effect';
import type {
  ChatSummary,
  EditAuthor,
  EditsState,
  MessageStatus,
  ReplyRef,
  UiMessage,
} from '@zilar/chat-core';
import type { Attachment, ForwardOrigin, Payload } from '@zilar/protocol';
import type { ChatMessage, Occupant, PresenceEvent, XmppCore } from '@zilar/xmpp-core';

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
 * Two lifetimes replace the old `generation` counter and the teardown lists.
 * The session scope holds what only `stop()` ends: the AppState listener, the
 * XMPP event subscriptions, the draft stream. The generation scope holds what
 * a restart also ends: boot, reconnect, polls and background loads. Closing a
 * scope interrupts every fiber forked into it.
 */
export interface Life {
  session(): Scope.Closeable;
  generation(): Scope.Closeable;
  /** Ends the current generation and opens the next one. */
  restartGeneration(): void;
  /** Ends the session (and the generation with it) and opens fresh scopes. */
  endSession(): void;
  /** Starts `task` now under `key` in the session; a task with the same key is interrupted first. */
  forkKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  /** Like `forkKeyed`, but in the generation: a restart ends it. */
  forkGenerationKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  /** Interrupts the session task with this key, if any. */
  cancel(key: string): void;
  /** Interrupts the generation task with this key, if any. */
  cancelGeneration(key: string): void;
}

/** An adapter over the core lifetime: the session is its store Scope, the generation its session. */
export function makeLife(): Life {
  const lifetime = makeLifetime(Context.empty());
  let generation = lifetime.beginSession();
  const restartGeneration = (): void => {
    generation = lifetime.beginSession();
  };
  return {
    session: () => lifetime.storeScope(),
    generation: () => generation.scope,
    restartGeneration,
    endSession: () => {
      lifetime.closeStore();
      restartGeneration();
    },
    forkKeyed: lifetime.forkKeyed,
    forkGenerationKeyed: (key, task) => generation.forkKeyed(key, task),
    cancel: lifetime.cancel,
    cancelGeneration: (key) => generation.cancel(key),
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
  /** First-page history loads in flight, by chat id (T-0067). */
  readonly loadingHistory: Set<string>;
  readonly loadingOlder: Set<string>;
  /** Chat id (topic rows too) -> group id. */
  readonly groupIds: Map<string, string>;
  /** Optimistic ids waiting for their server echo, by message signature. */
  readonly pendingOutgoing: Map<string, string[]>;
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
  readonly loadingGroupMembers: Set<string>;
}

/** The plain helpers of `real-store.ts` the effect modules call. */
export interface StoreHelpers {
  sortByRecency(chats: ChatSummary[]): ChatSummary[];
  summariesFor(entry: ChatEntry): ChatSummary[];
  rememberGroupIds(entries: ChatEntry[]): void;
  nick(me: Me): string;
  flushPending(): void;
  isVisible(): boolean;
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
  setHistoryLoad(chatId: string, load: 'loading' | 'loaded' | 'error'): void;
  clearSupersededMarker(chatId: string): void;
  groupIdForChat(chatId: string): string | undefined;
  rememberTopicRoles(topic: Topic): void;
  rememberMembers(chatId: string, detail: GroupDetail): void;
  myJid(): string | undefined;
  isOwnSender(fromJid: string): boolean;
  senderNameFor(message: {
    chatJid: string;
    fromJid: string;
    outgoing: boolean;
    fromNick?: string;
  }): string;
  wireTargetFor(messageId: string): string | undefined;
  correctionTargetFor(messageId: string): string | undefined;
  retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined;
  applyReactionUpdate(
    chatId: string,
    targetId: string,
    reactorJid: string,
    emojis: string[],
    order: number,
  ): void;
  restoreMessage(chatId: string, snapshot: UiMessage): void;
  restoreEdits(chatId: string, previous: EditsState | undefined): void;
  aliasRoot(id: string): string;
  rememberAuthor(messageId: string, author: EditAuthor): void;
  rememberOriginId(messageId: string, originId: string): void;
  linkMessageIds(left: string, right: string): void;
  linkLocalToServer(localId: string, serverId: string): void;
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
  setUploadProgress(chatId: string, messageId: string, progress: number): void;
  clearUploadProgress(chatId: string, messageId: string): void;
  forwardOriginFor(message: UiMessage): ForwardOrigin | undefined;
  forwardedPayloadFor(message: UiMessage): Payload | undefined;
  forwardedUiFieldsFor(payload: Payload): Pick<UiMessage, 'voice' | 'attachment' | 'card'>;
  startDraftStream(): void;
  startTopicsPolling(): void;
  /** Ends what `stop()` clears besides the scopes: timers, caches and per-session maps. */
  teardown(): void;
  handleMessage(message: ChatMessage): void;
  handleTyping(event: { chatJid: string; fromJid: string; state: string; outgoing: boolean }): void;
  handleDisplayed(event: {
    chatJid: string;
    fromJid: string;
    messageId: string;
    outgoing: boolean;
  }): void;
  handleOccupants(event: { roomJid: string; occupants: Occupant[] }): void;
  handlePresence(event: PresenceEvent): void;
  handleInvited(): void;
  handleRoster(): void;
}

/** Effects of one concern that another concern calls. Filled in by `real-store.ts`. */
export interface StoreFx {
  loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  loadFolders: Effect.Effect<void, never, Ports>;
  refreshChats: Effect.Effect<void, never, Ports>;
  loadPins(chatId: string, loud: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupMembers(chatId: string): Effect.Effect<void, never, Ports>;
  startPinsPolling(chatId: string): void;
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
