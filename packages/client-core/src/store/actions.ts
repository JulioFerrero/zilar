// Message actions (react, edit, delete, typing): each paints its result first and
// undoes it when the stanza send fails.
import { Effect } from 'effect';
import {
  applyEdit,
  canDeleteMessage,
  canEditMessage,
  emptyEdits,
  mentionsForTrimmedText,
  rebaseMentions,
  type ChatFolder,
  type ChatSummary,
  type EditAuthor,
  type EditUpdate,
  type EditsState,
  type ReactionsState,
  type UiMessage,
} from '@zilar/chat-core';
import type { Contact, MediaTab, Pin } from '@zilar/api-contract';
import type { MediaPage } from '../chat-extras-api';
import { fromPromise, type CoreCtx } from './ctx';
import { coreKind } from './rows';
import type { SendStickerInput, SendTextOptions } from './send/context';

export type { SendStickerInput, SendTextOptions } from './send/context';

/** Toggles my reaction of `emoji` (XEP-0444) optimistically; reverts when the send fails. */
export function react(ctx: CoreCtx, chatId: string, messageId: string, emoji: string): void {
  const { k } = ctx;
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  const mine = k.myJid();
  if (chat === undefined || mine === undefined) {
    return;
  }
  // The wire target must be the server id everyone knows; an unacked message has none,
  // so do nothing until it has one.
  const targetId = k.aliasRoot(messageId);
  const wireTarget = k.wireTargetFor(messageId);
  const currentCore = ctx.core;
  if (wireTarget === undefined || currentCore === undefined) {
    return;
  }
  const current = ctx.get().reactions[chatId]?.targets[targetId]?.[mine]?.emojis ?? [];
  const next = current.includes(emoji)
    ? current.filter((entry) => entry !== emoji)
    : [...current, emoji];
  const apply = (emojis: string[]): void => {
    k.applyReactionUpdate(chatId, targetId, mine, emojis, ctx.ports.now().getTime());
  };
  apply(next);
  ctx.rt.fork(
    fromPromise(() => currentCore.sendReactions(chatId, coreKind(chat), wireTarget, next)).pipe(
      Effect.catchCause(() => Effect.sync(() => apply(current))),
    ),
  );
}

export function editMessage(ctx: CoreCtx, chatId: string, messageId: string, text: string): void {
  const { k } = ctx;
  const trimmed = text.trim();
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  const mine = k.myJid();
  if (chat === undefined || mine === undefined || trimmed.length === 0) {
    return;
  }
  const message = k.listFor(ctx.get(), chatId).find((item) => k.sameMessage(item.id, messageId));
  if (message === undefined || !canEditMessage(message, ctx.get().currentUserId, ctx.ports.now())) {
    return;
  }
  // The UI already blocks a no-op edit; the store does too, so no stanza is sent for
  // unchanged text.
  if (message.text === trimmed) {
    return;
  }
  // XEP-0308 names the original by its sender-generated id.
  const wireTarget = k.correctionTargetFor(messageId);
  const currentCore = ctx.core;
  if (wireTarget === undefined || currentCore === undefined) {
    return;
  }
  const targetId = k.aliasRoot(messageId);
  const author: EditAuthor = { jid: mine, resolved: true };
  const priorMentions = rebaseMentions(message.text ?? '', text, message.mentions ?? []);
  const mentions = mentionsForTrimmedText(text, trimmed, priorMentions);
  const update: EditUpdate = {
    kind: 'correction',
    targetId,
    author,
    text: trimmed,
    order: ctx.ports.now().getTime(),
  };
  if (mentions.length > 0) {
    update.mentions = mentions;
  }
  const previous = ctx.get().edits[chatId];
  ctx.set({ actionError: undefined });
  ctx.set((state) => ({
    edits: {
      ...state.edits,
      [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
    },
  }));
  k.refreshEdits(chatId);
  ctx.rt.fork(
    fromPromise(() =>
      currentCore.sendCorrection(
        chatId,
        coreKind(chat),
        wireTarget,
        trimmed,
        mentions.length === 0
          ? undefined
          : {
              mentions: mentions.map((mention) => ({
                jid: mention.jid,
                begin: mention.begin,
                end: mention.end,
              })),
            },
      ),
    ).pipe(
      Effect.catchCause(() =>
        Effect.sync(() => {
          k.restoreMessage(chatId, message);
          k.restoreEdits(chatId, previous);
          ctx.set({ actionError: { chatId, message: 'Could not save the edit. Try again.' } });
        }),
      ),
    ),
  );
}

export function deleteForEveryone(ctx: CoreCtx, chatId: string, messageId: string): void {
  const { k } = ctx;
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  const mine = k.myJid();
  if (chat === undefined || mine === undefined) {
    return;
  }
  const message = k.listFor(ctx.get(), chatId).find((item) => k.sameMessage(item.id, messageId));
  if (message === undefined || !canDeleteMessage(message, ctx.get().currentUserId)) {
    return;
  }
  const wireTarget = k.retractionTargetFor(chat, messageId);
  const currentCore = ctx.core;
  if (wireTarget === undefined || currentCore === undefined) {
    return;
  }
  const targetId = k.aliasRoot(messageId);
  const author: EditAuthor = { jid: mine, resolved: true };
  const update: EditUpdate = {
    kind: 'retraction',
    targetId,
    author,
    order: ctx.ports.now().getTime(),
  };
  const previous = ctx.get().edits[chatId];
  ctx.set({ actionError: undefined });
  ctx.set((state) => ({
    edits: {
      ...state.edits,
      [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
    },
  }));
  k.refreshEdits(chatId);
  ctx.rt.fork(
    fromPromise(() => currentCore.sendRetraction(chatId, coreKind(chat), wireTarget)).pipe(
      Effect.catchCause(() =>
        Effect.sync(() => {
          k.restoreMessage(chatId, message);
          k.restoreEdits(chatId, previous);
          ctx.set({ actionError: { chatId, message: 'Could not delete the message. Try again.' } });
        }),
      ),
    ),
  );
}

export function sendTyping(ctx: CoreCtx, chatId: string): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (ctx.core !== undefined && chat !== undefined) {
    ctx.core.sendTyping(chatId, coreKind(chat), 'composing');
  }
}

export function stopTyping(ctx: CoreCtx, chatId: string): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (ctx.core !== undefined && chat !== undefined) {
    ctx.core.sendTyping(chatId, coreKind(chat), 'paused');
  }
}

export interface DraftState {
  turnId: string;
  text: string;
}

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface TypingState {
  names: string[];
}

/** The store fields the web and phone stores declare the same way. */
export interface ChatStoreCommonState {
  currentUserId: string;
  status: ConnectionStatus;
  chats: ChatSummary[];
  contacts: Contact[];
  messages: (chatId: string) => UiMessage[];
  messagesByChat: Record<string, UiMessage[]>;
  /** XEP-0444 reaction updates by chat id, keyed by the alias-resolved target message id;
   *  kept even for targets that are not loaded yet. */
  reactions: Record<string, ReactionsState>;
  /** XEP-0308/0424 edit state by chat id, keyed by the alias-resolved target message id, so
   *  an update arriving before its target stays pending. */
  edits: Record<string, EditsState>;
  historyComplete: Record<string, boolean>;
  typing: Record<string, TypingState>;
  /** Live AI reply drafts by chat id (the AI's bare JID). */
  drafts: Record<string, DraftState>;
  /** Message id -> the draft turn it replaced; the final message keeps the draft's key, so
   *  its reveal continues instead of snapping. */
  finishedDraftMessages: Record<string, string>;
  search: string;
  activeFolder: string;
  folders: ChatFolder[];
}

/** The store actions the web and phone stores declare the same way. */
export interface ChatStoreActions {
  retryHistory: (chatId: string) => void;
  openChat: (chatId: string) => void;
  /** Clears activeChatId when the leaving chat is still the open one, so a message arriving
   *  while the list is on screen counts as unread. */
  closeChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  hasMore: (chatId: string) => boolean;
  /** Opens a chat at one message, paging back until it is present; rejects with
   *  message_not_found when history runs out first. */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendSticker: (chatId: string, sticker: SendStickerInput, options?: SendTextOptions) => void;
  /** One optimistic copy per message per target, carrying a <forward> origin; failed and
   *  sending messages are skipped, and an optional comment is a separate text per target. */
  forwardMessages: (
    targets: string[],
    messages: UiMessage[],
    options?: { comment?: string },
  ) => void;
  retrySticker: (chatId: string, messageId: string) => void;
  retryAttachment: (chatId: string, messageId: string) => void;
  retryVoice: (chatId: string, messageId: string) => void;
  /** Removes a failed local bubble; only a failed message may go because the send never
   *  reached the server. */
  deleteFailedMessage: (chatId: string, messageId: string) => void;
  /** Toggles my reaction and sends my complete set (XEP-0444). Optimistic, reverted on failure. */
  react: (chatId: string, messageId: string, emoji: string) => void;
  startEdit: (chatId: string, messageId: string) => void;
  cancelEdit: () => void;
  /** Saves an edit (XEP-0308) optimistically, reverted when the send fails; unchanged text
   *  sends nothing. */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /** Deletes a message for everyone (XEP-0424). Optimistic, reverted on a send error. */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** Enables or disables the push pair over the XMPP session (XEP-0357); rejects offline. */
  setPushPair: (input: { pushJid: string; node: string; enable: boolean }) => Promise<void>;
  sendTyping: (chatId: string) => void;
  stopTyping: (chatId: string) => void;
  /** Pins of a chat, newest first; empty until loaded. */
  pins: (chatId: string) => Pin[];
  /** Loads one page of a chat's media gallery: before is the previous page's next cursor.
   *  Image items on an untrusted host come back without a url (a file row instead). */
  loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>;
  /** Whether the caller may pin: either side of a DM, a group owner/admin for topics; the
   *  server still enforces the creator edge. */
  canPin: (chatId: string) => boolean;
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /** Pins a message (snapshot from the loaded message). Optimistic with rollback. */
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  /** Removes a pin. Optimistic with rollback. Rejects on failure. */
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  dismissPinsError: () => void;
  markChatRead: (chatId: string) => Promise<void>;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: string) => void;
  setFolders: (folders: ChatFolder[]) => void;
  start: () => void;
  stop: () => void;
}
