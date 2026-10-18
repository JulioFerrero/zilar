// The ledger's edit state: applying a correction or retraction from a stanza,
// resolving edits that arrived before their target, re-attaching the current
// edit state to the loaded messages and their reply quotes, and restoring a
// message or its edit state after a failed send. Recording what a stanza
// carries, and ingesting history, live in `ledger-history-ingest.ts`.
import type { EditsState, ReplyRef } from '@zilar/chat-core';
import { editsFor, isSameAuthor, mentionsEqual, resolveEdits } from '@zilar/chat-core';
import type { Payload } from '@zilar/protocol';
import { listFor, previewFor } from './ledger-signatures';
import type { EditRecorder } from './ledger-history-ingest';
import type { LedgerIds } from './ledger-ids';
import type { LedgerIncoming } from './ledger-incoming';
import { createRoutineBump } from './ledger-routine-bump';
import type { CardEdit, LedgerSet, LedgerState, LedgerStanza, StoreMessage } from './ledger-types';

interface LedgerEditsDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
  readonly incoming: LedgerIncoming;
  readonly recorder: EditRecorder;
  /** The task-card updates a correction carries, newest order wins. */
  readonly cards: Map<string, CardEdit>;
}

export function createLedgerEdits(deps: LedgerEditsDeps) {
  const { get, set, cards, recorder } = deps;
  const { aliasRoot, authorFor, baseTextFor, sameMessage } = deps.ids;
  const { mapMentions } = deps.incoming;
  const routineBump = createRoutineBump({ get, set, sameMessage, render: withEdits });

  // A correction or retraction message only changes edit state; it never
  // touches the preview or the unread count. A correction may also carry a
  // task-card payload, which is remembered even when its body is empty. A live
  // routine correction is the one exception (T-1722): it bumps its chat, but
  // only when it arrives live — `ingestHistoryEdits` never bumps, so an old page
  // read back at boot or on open never reorders or inflates.
  function ingestEdit(message: LedgerStanza): void {
    const { update, applied } = recorder.recordEdit(message);
    if (update !== undefined) {
      resolvePendingEdits(message.chatJid);
      refreshEdits(message.chatJid);
      const routine = update.kind === 'correction' && message.payload?.type === 'routine';
      if (applied && routine) {
        routineBump.bumpRoutineChat(message.chatJid, update.targetId, update.author);
      }
      return;
    }
    if (recorder.hasCard(message)) {
      refreshEdits(message.chatJid);
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

  // The task card a correction carries for one message, when the update comes
  // from the original's author like a text correction does.
  function cardFor(message: StoreMessage): Payload | undefined {
    const entry = cards.get(aliasRoot(message.id));
    if (entry === undefined) {
      return undefined;
    }
    const author = authorFor(message.id);
    if (author === undefined || !isSameAuthor(author, entry.author)) {
      return undefined;
    }
    return entry.payload;
  }

  // Applies one message's current edit state. A deleted message keeps only
  // its place and identity (a retraction also drops the local upload state);
  // a corrected one shows the new text and mentions.
  function applyTextEdits(message: StoreMessage, chatId: string): StoreMessage {
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
      delete plain.editedAt;
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
        message.editedAt === undefined &&
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
      delete deleted.editedAt;
      delete deleted.failed;
      delete deleted.failureReason;
      return deleted;
    }
    const text = state.text ?? message.text;
    const mentions =
      state.mentions === undefined ? undefined : mapMentions(chatId, state.mentions, text ?? '');
    const editedAt = state.editedAt === undefined ? undefined : new Date(state.editedAt);
    if (
      message.edited === true &&
      message.deleted === undefined &&
      message.text === text &&
      mentionsEqual(message.mentions, mentions) &&
      message.editedAt?.getTime() === state.editedAt
    ) {
      return message;
    }
    const edited: StoreMessage = { ...message, edited: true };
    delete edited.deleted;
    if (editedAt === undefined) {
      delete edited.editedAt;
    } else {
      edited.editedAt = editedAt;
    }
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

  // The rendered message: its edit state, then the task card a correction
  // replaced. A deleted message keeps no card.
  function withEdits(message: StoreMessage, chatId: string): StoreMessage {
    const edited = applyTextEdits(message, chatId);
    if (edited.deleted === true) {
      return edited;
    }
    const card = cardFor(edited);
    if (card === undefined || edited.card === card) {
      return edited;
    }
    return { ...edited, card };
  }

  // A reply quote follows its target: the corrected text, or "Deleted
  // message" once the target was retracted. `referenced` is the target, found
  // through the list's index by alias root.
  function withReplyQuote(
    message: StoreMessage,
    referenced: StoreMessage | undefined,
  ): StoreMessage {
    const quote = message.replyTo;
    if (quote === undefined || referenced === undefined) {
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

  // The first index of each message by alias root, so a reply or the preview
  // finds its target without scanning the list.
  function indexByRoot(list: readonly StoreMessage[]): Map<string, number> {
    const index = new Map<string, number>();
    list.forEach((message, position) => {
      const root = aliasRoot(message.id);
      if (!index.has(root)) {
        index.set(root, position);
      }
    });
    return index;
  }

  // Re-attaches the current edit state to every loaded message of a chat and
  // follows reply quotes and the preview.
  function refreshEdits(chatId: string): void {
    const state = get();
    const list = listFor(state, chatId);
    if (
      state.edits[chatId] === undefined &&
      !list.some((m) => m.edited === true || m.deleted === true || cards.has(aliasRoot(m.id)))
    ) {
      return;
    }
    const edited = list.map((message) => withEdits(message, chatId));
    const positions = indexByRoot(edited);
    const find = (messages: readonly StoreMessage[], id: string): StoreMessage | undefined => {
      const position = positions.get(aliasRoot(id));
      return position === undefined ? undefined : messages[position];
    };
    const refreshed = edited.map((message) =>
      message.replyTo === undefined
        ? message
        : withReplyQuote(message, find(edited, message.replyTo.id)),
    );
    const listChanged = refreshed.some((message, index) => message !== list[index]);
    const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
    const lastRefreshed = last === undefined ? undefined : find(refreshed, last.id);
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
    resolvePendingEdits,
    withEdits,
    refreshEdits,
    restoreMessage,
    restoreEdits,
  };
}

export type LedgerEdits = ReturnType<typeof createLedgerEdits>;
