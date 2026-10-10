import { Effect } from 'effect';
import type { ChatSummary, ReplyRef, UiMessage } from '@zilar/chat-core';
import type { Payload } from '@zilar/protocol';
import { StickerSchema, isValid } from '@zilar/protocol';
import {
  clearActionError,
  linkSent,
  nextLocalId,
  queueOutgoing,
  rememberMyAuthor,
} from './context';
import type { SendCtx, SendStickerInput, SendTextOptions } from './context';
import { fromPromise } from '../ctx';
import { clearFailure, coreKind } from '../rows';

/** The send step of a sticker, re-runnable from a Retry: only the stanza is (re)sent. */
function runStickerSend(
  ctx: SendCtx,
  chat: ChatSummary,
  localId: string,
  payload: Extract<Payload, { type: 'sticker' }>,
  body: string,
  replyTo: ReplyRef | undefined,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markStickerFailed(chat.id, localId);
    return;
  }
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(chat.id, coreKind(chat), body, {
        payload,
        ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
      }),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, chat, localId, sent.id);
          ctx.k.updateMessageStatus(chat.id, localId, 'sent');
        }),
      ),
      Effect.catchCause(() => Effect.sync(() => ctx.k.markStickerFailed(chat.id, localId))),
    ),
  );
}

export function sendSticker(
  ctx: SendCtx,
  chatId: string,
  sticker: SendStickerInput,
  options?: SendTextOptions,
): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return;
  }
  // The choice may come from tampered localStorage recents or drifted pack
  // rows: validate before the optimistic insert, because `encodePayload`
  // throws synchronously on an invalid payload and would otherwise leave a
  // stuck `sending` bubble with no retry.
  const data = {
    pack_id: sticker.packId,
    sticker_id: sticker.stickerId,
    url: sticker.url,
    ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
    width: sticker.width,
    height: sticker.height,
    mime: sticker.mime,
  };
  if (!isValid(StickerSchema)(data)) {
    ctx.set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
    return;
  }
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const body = sticker.emoji ?? '';
  const payload = { v: 0, type: 'sticker', data } as const;
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    text: body,
    createdAt: ctx.ports.now(),
    status: 'sending',
    card: payload,
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  clearActionError(ctx, chatId);
  queueOutgoing(ctx, ctx.k.stickerSignatureFor(chatId, body, sticker.stickerId, replyTo), localId);
  ctx.k.setChatMessage(chatId, message, true);
  rememberMyAuthor(ctx, localId);
  if (body.length > 0) {
    ctx.k.rememberBaseText(localId, body);
  }
  if (ctx.core === undefined) {
    ctx.k.markStickerFailed(chatId, localId);
    return;
  }
  runStickerSend(ctx, chat, localId, payload, body, replyTo);
}

export function retrySticker(ctx: SendCtx, chatId: string, messageId: string): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return;
  }
  const message = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  const payload =
    message?.card !== undefined && message.card.type === 'sticker' ? message.card : undefined;
  if (message === undefined || payload === undefined) {
    return;
  }
  if (!isValid(StickerSchema)(payload.data)) {
    ctx.k.markStickerFailed(chatId, messageId);
    return;
  }
  // A retried sticker is a send too: a stale error banner clears (R20). No
  // echo entry is re-enqueued: a failed first send was never echoed, so its
  // queued id is still there for a later identical sticker.
  ctx.set((state) => ({
    actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: ctx.k
        .listFor(state, chatId)
        .map((item) => (ctx.k.sameMessage(item.id, messageId) ? clearFailure(item) : item)),
    },
  }));
  runStickerSend(ctx, chat, messageId, payload, message.text ?? '', message.replyTo);
}
