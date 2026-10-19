import {
  makeLifetime,
  type CoreCtx,
  type CoreLocals,
  type JoinGroupsHooks,
  type Lifetime,
  type SendRun,
} from '@zilar/client-core/store';
import { Context, Effect, Exit, Fiber, Scope } from 'effect';
import type { ChatSummary, EditAuthor, MessageStatus, ReplyRef, UiMessage } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';

import type { PickedFile } from '../../lib/attachment-ports';
import type { OfflineCacheSync } from '../offline-cache-sync';
import type { RecordedVoice } from '../../lib/voice';
import type { VoiceFailureReason } from '../../lib/voice-failure';
import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import type { GroupRole } from '@zilar/api-contract';
import type { ApproverRole, Topic, TopicRole } from '../../lib/topics-api';
import type { SetState } from '@zilar/client-core';
import type { ChatStoreState } from '../types';
import { Ports, type PortsShape } from './ports';

export const lift = <A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: thunk, catch: (error) => error });

/** Interruption is not a failure: an interrupted fiber never reaches the handler. */
export const recover = <A, B, E, R>(
  effect: Effect.Effect<A, E, R>,
  onFail: (error: unknown) => Effect.Effect<B, never, R>,
): Effect.Effect<A | B, never, R> =>
  effect.pipe(
    Effect.catch((error) => onFail(error)),
    Effect.catchDefect((defect) => onFail(defect)),
  );

export const orElse = <A, B, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: B,
): Effect.Effect<A | B, never, R> => recover(effect, () => Effect.succeed(fallback));

/** Own fiber at once, joined: a sibling failing cannot cancel it. */
export const detached = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.forkDetach(effect, { startImmediately: true }), Fiber.join);

export const isClosed = (scope: Scope.Scope): boolean => scope.state._tag === 'Closed';

export function onClose(scope: Scope.Scope, finalizer: () => void): void {
  Effect.runSync(Scope.addFinalizer(scope, Effect.sync(finalizer)));
}

export function closeScope(scope: Scope.Closeable): void {
  Effect.runFork(Scope.close(scope, Exit.void));
}

export interface Life {
  readonly lifetime: Lifetime<never>;
  session(): Scope.Closeable;
  generation(): Scope.Scope;
  restartGeneration(): void;
  endSession(): void;
  /** A task with the same key is interrupted first. */
  forkKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  /** Like `forkKeyed`, but a task with the same key ends with the session. */
  forkGenerationKeyed(key: string, task: Effect.Effect<unknown>): Fiber.Fiber<unknown, never>;
  cancel(key: string): void;
  cancelGeneration(key: string): void;
}

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

export interface StoreState extends CoreLocals {
  started: boolean;
  firstToken: { jid: string; token: string } | undefined;
  /** The boot in flight, one per generation, so a resume can wait for it. */
  boot: { scope: Scope.Scope; fiber: Fiber.Fiber<void> | undefined } | undefined;
  mediaTrustedHosts: ReadonlySet<string>;
  chatPrefRows: ChatPref[];
  /** Done turns, so a late `draft` is ignored. */
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
  sequence: number;
  readonly sendRuns: Map<string, SendRun>;
  readonly pendingUploads: Map<string, PickedFile>;
  readonly pendingVoices: Map<string, RecordedVoice>;
  readonly groupDetails: Map<string, GroupDetail>;
  readonly loadingGroupDetails: Set<string>;
  readonly groupRolesById: Map<string, GroupRole[]>;
  readonly loadingGroupRoles: Set<string>;
  readonly topicRolesById: Map<string, { roles: TopicRole[]; approverRole: ApproverRole | null }>;
  readonly loadingTopicRoles: Set<string>;
  /** Chat id -> (lowercased user id -> display name). */
  readonly groupMembers: Map<string, Map<string, string>>;
}

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
  teardown(): void;
}

export interface StoreFx {
  loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  loadFolders: Effect.Effect<void, never, Ports>;
  refreshChats: Effect.Effect<void, never, Ports>;
  loadPins(chatId: string, loud: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupMembers(chatId: string): Effect.Effect<void, never, Ports>;
  scheduleChatsRefresh(): void;
  startPinsPolling(chatId: string): void;
  refreshActiveChatPins(chatId: string): void;
  restartBoot(): void;
  joinGroups(current: XmppCore, me: Me, hooks?: JoinGroupsHooks): Effect.Effect<void, never, Ports>;
  loadPreview(current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports>;
}

export interface StoreCtx {
  readonly ports: PortsShape;
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly s: StoreState;
  readonly life: Life;
  readonly h: StoreHelpers;
  readonly fx: StoreFx;
  readonly coreCtx: CoreCtx;
  readonly offline: OfflineCacheSync;
  fork<A, E>(effect: Effect.Effect<A, E, Ports>, scope?: Scope.Scope): Fiber.Fiber<A, E>;
  /** Background work that survives a restart of the boot but not `stop()`. */
  forkSession<A, E>(effect: Effect.Effect<A, E, Ports>): Fiber.Fiber<A, E>;
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
