// Actions on a message that is already in the chat: reacting, editing and
// deleting for everyone, and the typing signal. Each one paints its result
// first and undoes it when the stanza send fails.
import { Effect } from 'effect';
import {
  applyEdit,
  canDeleteMessage,
  canEditMessage,
  emptyEdits,
  mentionsForTrimmedText,
  rebaseMentions,
  type EditAuthor,
  type EditUpdate,
} from '@zilar/chat-core';
import { coreKind } from './chatRows';
import type { StoreCtx } from './ctx';
import { fromPromise } from './util';

/**
 * Toggles my reaction of `emoji` on a message and sends my complete set
 * (XEP-0444). Optimistic; it reverts when the send fails.
 */
export function react(ctx: StoreCtx, chatId: string, messageId: string, emoji: string): void {
  const { k } = ctx;
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  const mine = k.myJid();
  if (chat === undefined || mine === undefined) {
    return;
  }
  // The local key is alias-resolved; the wire target must be the server id
  // everyone else knows. An unacked message has none yet, so reacting would
  // send a target nobody could match: do nothing until it has one.
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
      // The send failed: undo the optimistic toggle.
      Effect.catchCause(() => Effect.sync(() => apply(current))),
    ),
  );
}

export function editMessage(ctx: StoreCtx, chatId: string, messageId: string, text: string): void {
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
  // The UI already blocks a no-op edit; the store does too, so no stanza is
  // ever sent for an unchanged text.
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

export function deleteForEveryone(ctx: StoreCtx, chatId: string, messageId: string): void {
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

export function sendTyping(ctx: StoreCtx, chatId: string): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (ctx.core !== undefined && chat !== undefined) {
    ctx.core.sendTyping(chatId, coreKind(chat), 'composing');
  }
}
