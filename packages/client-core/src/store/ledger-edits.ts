// The ledger's edit state: applying a correction or retraction from a stanza or
// from history, resolving edits that arrived before their target, re-attaching
// the current edit state to the loaded messages and their reply quotes, and
// restoring a message or its edit state after a failed send. Moved unchanged
// from `store/ledger.ts` (size split).
import type { EditUpdate, EditsState, ReplyRef } from '@zilar/chat-core';
import { applyEdit, editsFor, emptyEdits, mentionsEqual, resolveEdits } from '@zilar/chat-core';
import { authorOfChatMessage, isEditStanza, listFor, previewFor } from './ledger-signatures';
import type { LedgerIds } from './ledger-ids';
import type { LedgerIncoming } from './ledger-incoming';
import type { LedgerSet, LedgerState, LedgerStanza, StoreMessage } from './ledger-types';

interface LedgerEditsDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
  readonly incoming: LedgerIncoming;
}

export function createLedgerEdits(deps: LedgerEditsDeps) {
  const { get, set } = deps;
  const { aliasRoot, authorFor, baseTextFor, sameMessage } = deps.ids;
  const { mapMentions } = deps.incoming;

  function editUpdateFor(message: LedgerStanza): EditUpdate | undefined {
    const order = message.timestamp.getTime();
    const author = authorOfChatMessage(message);
    if (message.retraction !== undefined) {
      return {
        kind: 'retraction',
        targetId: aliasRoot(message.retraction.targetId),
        author,
        order,
      };
    }
    if (message.correction !== undefined) {
      // A correction without a body has no new text: ignore it rather than
      // blanking the original.
      if (message.body === undefined) {
        return undefined;
      }
      const update: EditUpdate = {
        kind: 'correction',
        targetId: aliasRoot(message.correction.targetId),
        author,
        text: message.body,
        order,
      };
      if (message.mentions !== undefined && message.mentions.length > 0) {
        update.mentions = message.mentions;
      }
      return update;
    }
    return undefined;
  }

  function applyEditUpdate(chatId: string, update: EditUpdate): void {
    const target = authorFor(update.targetId);
    set((state) => ({
      edits: {
        ...state.edits,
        [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, target),
      },
    }));
    resolvePendingEdits(chatId);
    refreshEdits(chatId);
  }

  // A correction or retraction message only changes edit state; it never
  // touches the preview or the unread count.
  function ingestEdit(message: LedgerStanza): void {
    const update = editUpdateFor(message);
    if (update === undefined) {
      return;
    }
    applyEditUpdate(message.chatJid, update);
  }

  function ingestHistoryEdits(messages: readonly LedgerStanza[]): void {
    for (const message of messages) {
      if (isEditStanza(message)) {
        ingestEdit(message);
      }
    }
  }

  // Applies the edits that arrived before their target message was loaded.
  function resolvePendingEdits(chatId: string): void {
    const chatEdits = get().edits[chatId];
    if (chatEdits === undefined) {
      return;
    }
    let next = chatEdits;
    let changed = false;
    for (const targetId of Object.keys(chatEdits.targets)) {
      const entry = next.targets[targetId];
      if (entry === undefined || entry.pending.length === 0) {
        continue;
      }
      const author = authorFor(targetId);
      if (author === undefined) {
        continue;
      }
      next = resolveEdits(next, targetId, author);
      changed = true;
    }
    if (!changed) {
      return;
    }
    set((state) => ({ edits: { ...state.edits, [chatId]: next } }));
  }

  // Applies one message's current edit state. A deleted message keeps only
  // its place and identity (a retraction also drops the local upload state);
  // a corrected one shows the new text and mentions.
  function withEdits(message: StoreMessage, chatId: string): StoreMessage {
    const chatEdits = get().edits[chatId];
    const state = chatEdits === undefined ? undefined : editsFor(chatEdits, aliasRoot(message.id));
    if (state === undefined || (!state.edited && !state.deleted)) {
      // A reverted edit restores the text the message was first seen with.
      const base = baseTextFor(message.id);
      const restoreText = message.text !== base;
      if (message.edited === undefined && message.deleted === undefined && !restoreText) {
        return message;
      }
      const plain: StoreMessage = { ...message };
      delete plain.edited;
      delete plain.deleted;
      if (restoreText) {
        if (base === undefined) {
          delete plain.text;
        } else {
          plain.text = base;
        }
      }
      return plain;
    }
    if (state.deleted) {
      if (
        message.deleted === true &&
        message.text === undefined &&
        message.voice === undefined &&
        message.image === undefined &&
        message.attachment === undefined &&
        message.card === undefined &&
        message.reactions === undefined &&
        message.mentions === undefined &&
        message.edited === undefined &&
        message.failed === undefined &&
        message.failureReason === undefined &&
        message.localUri === undefined &&
        message.uploadProgress === undefined
      ) {
        return message;
      }
      const deleted: StoreMessage = { ...message, deleted: true };
      delete deleted.text;
      delete deleted.voice;
      delete deleted.image;
      delete deleted.attachment;
      delete deleted.localUri;
      delete deleted.uploadProgress;
      delete deleted.card;
      delete deleted.reactions;
      delete deleted.mentions;
      delete deleted.edited;
      delete deleted.failed;
      delete deleted.failureReason;
      return deleted;
    }
    const text = state.text ?? message.text;
    const mentions =
      state.mentions === undefined ? undefined : mapMentions(chatId, state.mentions, text ?? '');
    if (
      message.edited === true &&
      message.deleted === undefined &&
      message.text === text &&
      mentionsEqual(message.mentions, mentions)
    ) {
      return message;
    }
    const edited: StoreMessage = { ...message, edited: true };
    delete edited.deleted;
    if (text === undefined) {
      delete edited.text;
    } else {
      edited.text = text;
    }
    if (mentions === undefined || mentions.length === 0) {
      delete edited.mentions;
    } else {
      edited.mentions = mentions;
    }
    return edited;
  }

  // A reply quote follows its target: the corrected text, or "Deleted
  // message" once the target was retracted.
  function withReplyQuote(list: readonly StoreMessage[], message: StoreMessage): StoreMessage {
    const quote = message.replyTo;
    if (quote === undefined) {
      return message;
    }
    const referenced = list.find((item) => sameMessage(item.id, quote.id));
    if (referenced === undefined) {
      return message;
    }
    const text = referenced.deleted === true ? 'Deleted message' : referenced.text;
    if (text === quote.text) {
      return message;
    }
    const replyTo: ReplyRef = { ...quote };
    if (text === undefined) {
      delete replyTo.text;
    } else {
      replyTo.text = text;
    }
    return { ...message, replyTo };
  }

  // Re-attaches the current edit state to every loaded message of a chat and
  // follows reply quotes and the preview.
  function refreshEdits(chatId: string): void {
    const state = get();
    const list = listFor(state, chatId);
    if (
      state.edits[chatId] === undefined &&
      !list.some((m) => m.edited === true || m.deleted === true)
    ) {
      return;
    }
    const edited = list.map((message) => withEdits(message, chatId));
    const refreshed = edited.map((message) => withReplyQuote(edited, message));
    const listChanged = refreshed.some((message, index) => message !== list[index]);
    const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
    const lastRefreshed =
      last === undefined ? undefined : refreshed.find((item) => sameMessage(item.id, last.id));
    const lastChanged = last !== undefined && lastRefreshed !== undefined && lastRefreshed !== last;
    if (!listChanged && !lastChanged) {
      return;
    }
    const changedLast = lastChanged ? lastRefreshed : undefined;
    set((previous) => ({
      messagesByChat: listChanged
        ? { ...previous.messagesByChat, [chatId]: refreshed }
        : previous.messagesByChat,
      chats:
        changedLast === undefined
          ? previous.chats
          : previous.chats.map((chat) =>
              chat.id === chatId && chat.lastMessage !== undefined
                ? { ...chat, lastMessage: previewFor(changedLast) }
                : chat,
            ),
    }));
  }

  function restoreEdits(chatId: string, previous: EditsState | undefined): void {
    set((state) => {
      const edits = { ...state.edits };
      if (previous === undefined) {
        delete edits[chatId];
      } else {
        edits[chatId] = previous;
      }
      return { edits };
    });
    refreshEdits(chatId);
  }

  // Puts a message back exactly as it was before an optimistic edit or delete,
  // so a failed send restores the fields a retraction had stripped.
  function restoreMessage(chatId: string, snapshot: StoreMessage): void {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: listFor(state, chatId).map((item) =>
          sameMessage(item.id, snapshot.id) ? snapshot : item,
        ),
      },
    }));
  }

  return {
    ingestEdit,
    ingestHistoryEdits,
    resolvePendingEdits,
    withEdits,
    refreshEdits,
    restoreMessage,
    restoreEdits,
  };
}

export type LedgerEdits = ReturnType<typeof createLedgerEdits>;
