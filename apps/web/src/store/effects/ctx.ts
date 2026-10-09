// What the effect modules share about one chat store: the state accessors, the
// ports, the lifetime, the mutable bookkeeping the store keeps beside its
// state, and the plain helpers (`k`) that stay in `realStore.ts`.
import type {
  Attachment,
  ChatSummary,
  EditAuthor,
  EditsState,
  MentionMember,
  MessageStatus,
  ReplyRef,
  SendFailureReason,
  UiMessage,
  VoiceMeta,
} from '@zilar/chat-core';
import type { Deferred } from 'effect';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import type { ChatEntry, GroupDetail, Me } from '@/lib/api';
import type { MediaTokenShape } from '@/lib/attachments';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../store';
import type { PortsShape } from './ports';
import type { Lifetime } from './runtime';

/** The plain helpers of `realStore.ts` that effect modules call. */
export interface Kernel {
  rememberGroupIds(entries: ChatEntry[]): void;
  nick(me: Me): string;
  listFor(state: ChatStoreState, chatId: string): UiMessage[];
  sameMessage(left: string, right: string): boolean;
  ingestHistoryReactions(messages: readonly ChatMessage[]): void;
  ingestHistoryEdits(messages: readonly ChatMessage[]): void;
  isReactionOnly(message: ChatMessage): boolean;
  isEditStanza(message: ChatMessage): boolean;
  toUiMessage(message: ChatMessage, meId: string): UiMessage;
  resolvePendingEdits(chatId: string): void;
  withEdits(message: UiMessage, chatId: string): UiMessage;
  refreshEdits(chatId: string): void;
  previewFor(message: UiMessage): UiMessage;
  myJid(): string | undefined;
  aliasRoot(id: string): string;
  linkMessageIds(left: string, right: string): void;
  linkLocalToServer(localId: string, serverId: string): void;
  rememberOriginId(messageId: string, originId: string): void;
  rememberAuthor(messageId: string, author: EditAuthor): void;
  rememberBaseText(messageId: string, text: string): void;
  authorFor(messageId: string): EditAuthor | undefined;
  correctionTargetFor(messageId: string): string | undefined;
  signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string;
  stickerSignatureFor(
    chatId: string,
    body: string,
    stickerId: string,
    replyTo: ReplyRef | undefined,
  ): string;
  setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void;
  updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): void;
  updateMessageVoice(chatId: string, messageId: string, voice: VoiceMeta): void;
  updateMessageAttachment(chatId: string, messageId: string, attachment: Attachment): void;
  markSendFailed(chatId: string, messageId: string, reason: SendFailureReason): void;
  markSendRetrying(chatId: string, messageId: string): void;
  markStickerFailed(chatId: string, messageId: string): void;
  markAttachmentFailed(chatId: string, messageId: string): void;
  removeFailedMessage(chatId: string, messageId: string): void;
  clearSendFailure(chatId: string, messageId: string): void;
  isOwnSender(fromJid: string): boolean;
  senderNameFor(message: ChatMessage): string;
  ingestEdit(message: ChatMessage): void;
  ingestReaction(message: ChatMessage): void;
  applyReactionUpdate(
    chatId: string,
    targetId: string,
    reactorJid: string,
    emojis: string[],
    order: number,
  ): void;
  wireTargetFor(messageId: string): string | undefined;
  retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined;
  restoreMessage(chatId: string, snapshot: UiMessage): void;
  restoreEdits(chatId: string, previous: EditsState | undefined): void;
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
