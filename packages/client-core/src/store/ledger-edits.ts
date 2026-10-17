// The ledger's edit state: applying a correction or retraction from a stanza or
// from history, resolving edits that arrived before their target, re-attaching
// the current edit state to the loaded messages and their reply quotes, and
// restoring a message or its edit state after a failed send. Moved unchanged
// from `store/ledger.ts` (size split).
import type { EditUpdate, EditsState, ReplyRef } from '@zilar/chat-core';
import {
  applyEdit,
  editsFor,
  emptyEdits,
  isSameAuthor,
  mentionsEqual,
  resolveEdits,
} from '@zilar/chat-core';
import type { Payload } from '@zilar/protocol';
import { authorOfChatMessage, isEditStanza, listFor, previewFor } from './ledger-signatures';
import type { LedgerIds } from './ledger-ids';
import type { LedgerIncoming } from './ledger-incoming';
import { correctionChanged, createRoutineBump } from './ledger-routine-bump';
import type { CardEdit, LedgerSet, LedgerState, LedgerStanza, StoreMessage } from './ledger-types';

interface LedgerEditsDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
  readonly incoming: LedgerIncoming;
  /** The task-card updates a correction carries, newest order wins. */
  readonly cards: Map<string, CardEdit>;
}

export function createLedgerEdits(deps: LedgerEditsDeps) {
  const { get, set, cards } = deps;
  const { aliasRoot, authorFor, baseTextFor, sameMessage } = deps.ids;
  const { mapMentions } = deps.incoming;
  const routineBump = createRoutineBump({ get, set, sameMessage, render: withEdits });

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

  // A correction carrying a progress or blocks payload replaces its target's
  // card (T-1419, T-1810 for block card answers). A body-less one still counts:
  // the card is the whole update. Any other payload type is not a card edit.
  function cardEditFor(message: LedgerStanza): CardEdit | undefined {
    const correction = message.correction;
    const payload = message.payload;
    const isCard = payload?.type === 'progress' || payload?.type === 'blocks';
    if (correction === undefined || payload === undefined || !isCard) {
      return undefined;
    }
    return {
      order: message.timestamp.getTime(),
      author: authorOfChatMessage(message),
      payload,
    };
  }

  // Remembers a card update under the alias root of its target, so it lands on
  // whichever id the message is stored under. An update from another author is
  // ignored, like a text correction, and an older stanza order never overwrites
  // a newer one.
  function rememberCard(targetId: string, entry: CardEdit): void {
    const targetAuthor = authorFor(targetId);
    if (targetAuthor !== undefined && !isSameAuthor(targetAuthor, entry.author)) {
      return;
    }
    const root = aliasRoot(targetId);
    const existing = cards.get(root);
    if (existing !== undefined && existing.order > entry.order) {
      return;
    }
    cards.set(root, entry);
  }

  // Whether the correction changed the target's edit state. `applyEdit` returns
  // a fresh object even for a stale order or a redelivered duplicate stanza.
  function applyEditUpdate(chatId: string, update: EditUpdate): boolean {
    const target = authorFor(update.targetId);
    const before = get().edits[chatId]?.targets[update.targetId];
    set((state) => ({
      edits: {
        ...state.edits,
        [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, target),
      },
    }));
    const after = get().edits[chatId]?.targets[update.targetId];
    resolvePendingEdits(chatId);
    refreshEdits(chatId);
    return target !== undefined && correctionChanged(before, after);
  }

  // A correction or retraction message only changes edit state; it never
  // touches the preview or the unread count. A correction may also carry a
  // task-card payload, which is remembered even when its body is empty. A live
  // routine correction is the one exception (T-1722): it bumps its chat, but
  // only when it arrives live — `ingestHistoryEdits` passes `bumpRoutine` false,
  // so an old page read back at boot or on open never reorders or inflates.
  function ingestEdit(message: LedgerStanza, bumpRoutine = true): void {
    const card = cardEditFor(message);
    if (card !== undefined && message.correction !== undefined) {
      rememberCard(message.correction.targetId, card);
    }
    const update = editUpdateFor(message);
    if (update !== undefined) {
      const applied = applyEditUpdate(message.chatJid, update);
      const routine = update.kind === 'correction' && message.payload?.type === 'routine';
      if (bumpRoutine && applied && routine) {
        routineBump.bumpRoutineChat(message.chatJid, update.targetId, update.author);
      }
      return;
    }
    if (card !== undefined) {
      refreshEdits(message.chatJid);
    }
  }

  function ingestHistoryEdits(messages: readonly LedgerStanza[]): void {
    for (const message of messages) {
      if (isEditStanza(message)) {
        ingestEdit(message, false);
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
      !list.some((m) => m.edited === true || m.deleted === true || cards.has(aliasRoot(m.id)))
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
