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
  wireReply,
} from './context';
import type { SendCtx, SendStickerInput, SendTextOptions } from './context';
import { fromPromise } from '../ctx';
import { coreKind } from '../rows';

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
    ctx.k.markSendFailed(chat.id, localId, 'network');
    return;
  }
  const quote = wireReply(ctx, replyTo);
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(chat.id, coreKind(chat), body, {
        payload,
        ...(quote === undefined
          ? {}
          : {
              replyTo: {
                id: quote.id,
                ...(quote.text === undefined ? {} : { text: quote.text }),
              },
            }),
      }),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, chat, localId, sent.id);
          ctx.k.updateMessageStatus(chat.id, localId, 'sent');
        }),
      ),
      Effect.catchCause(() => Effect.sync(() => ctx.k.markSendFailed(chat.id, localId, 'network'))),
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
  // The choice may come from tampered localStorage recents or drifted pack rows: validate
  // before the optimistic insert, or `encodePayload` throws synchronously and leaves a
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
  queueOutgoing(
    ctx,
    ctx.k.stickerSignatureFor(chatId, body, sticker.stickerId, wireReply(ctx, replyTo)),
    localId,
  );
  ctx.k.setChatMessage(chatId, message, true);
  rememberMyAuthor(ctx, localId);
  if (body.length > 0) {
    ctx.k.rememberBaseText(localId, body);
  }
  if (ctx.core === undefined) {
    ctx.k.markSendFailed(chatId, localId, 'network');
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
  // Like the other retries: only a `failed` bubble may relaunch, so a double Retry click
  // cannot double-send.
  if (message === undefined || payload === undefined || message.status !== 'failed') {
    return;
  }
  if (!isValid(StickerSchema)(payload.data)) {
    ctx.k.markSendFailed(chatId, messageId, 'network');
    return;
  }
  // A retried sticker clears a stale error banner and leaves `failed` for `sending` like
  // every retry. No echo entry is re-enqueued: the failed first send was never echoed, so
  // its queued id is still there.
  ctx.set((state) => ({
    actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
  }));
  ctx.k.markSendRetrying(chatId, messageId);
  runStickerSend(ctx, chat, messageId, payload, message.text ?? '', message.replyTo);
}
