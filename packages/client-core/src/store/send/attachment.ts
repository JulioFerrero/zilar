import { Effect } from 'effect';
import type { AlbumRef, Attachment, ChatSummary, ReplyRef, UiMessage } from '@zilar/chat-core';
import {
  clearActionError,
  clearUploadProgress,
  linkSent,
  nextLocalId,
  queueOutgoing,
  rememberMyAuthor,
  setUploadProgress,
  wireReply,
} from './context';
import type { SendAttachmentOptions, SendCtx } from './context';
import { fromPromise } from '../ctx';
import {
  armSendTimeout,
  isCurrentSendRun,
  messageAlive,
  newRun,
  settleFailure,
  settleSendTimeout,
} from './pipeline';
import type { OutgoingBytesData } from '../ports';
import { coreKind } from '../rows';

/** The `urn:zilar:album:0` bounds (`docs/audit/albums-plan.md` §1.4). A marker
 * outside them is dropped, so the photo is sent as a single message. */
const ALBUM_MIN_COUNT = 2;
const ALBUM_MAX_COUNT = 10;
const ALBUM_ID_MAX = 64;

function validAlbum(album: AlbumRef | undefined): AlbumRef | undefined {
  if (album === undefined) {
    return undefined;
  }
  const { id, index, count } = album;
  if (id.length === 0 || id.length > ALBUM_ID_MAX) {
    return undefined;
  }
  if (!Number.isInteger(count) || count < ALBUM_MIN_COUNT || count > ALBUM_MAX_COUNT) {
    return undefined;
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return undefined;
  }
  return album;
}

/**
 * The upload steps of an attachment, re-runnable from a Retry: read the image
 * size when it is one, PUT the bytes, then send the payload message.
 */
function runAttachmentUpload(
  ctx: SendCtx,
  chat: ChatSummary,
  localId: string,
  file: unknown,
  info: OutgoingBytesData,
  caption: string,
  replyTo: ReplyRef | undefined,
  album: AlbumRef | undefined,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markSendFailed(chat.id, localId, 'network');
    return;
  }
  // The peer can resolve the quote only by the shared wire id; the local id
  // only exists on this device.
  const quote = wireReply(ctx, replyTo);
  const run = newRun();
  armSendTimeout(ctx, chat.id, localId, run);
  ctx.rt.fork(
    Effect.gen(function* () {
      const { bytes } = ctx.ports;
      const measured = info.kind === 'image' ? yield* bytes.measure(file) : undefined;
      const url = yield* bytes.upload(
        current,
        file,
        (fraction) => setUploadProgress(ctx, chat.id, localId, fraction),
        localId,
      );
      // A cancel removed the bubble while the slot request or the PUT was in
      // flight: the bytes may be up, but nothing must be sent.
      if (!messageAlive(ctx, chat.id, localId)) {
        settleSendTimeout(ctx, localId, run);
        return;
      }
      const data: Attachment = {
        kind: info.kind,
        url,
        name: info.name,
        size: info.size,
        mime: info.mime,
        ...(measured === undefined ? {} : { width: measured.width, height: measured.height }),
      };
      ctx.k.updateMessageAttachment(chat.id, localId, data);
      clearUploadProgress(ctx, chat.id, localId);
      const sent = yield* fromPromise(() =>
        current.sendMessage(chat.id, coreKind(chat), caption, {
          payload: { v: 0, type: 'attachment', data },
          ...(quote === undefined
            ? {}
            : {
                replyTo: {
                  id: quote.id,
                  ...(quote.text === undefined ? {} : { text: quote.text }),
                },
              }),
          ...(album === undefined ? {} : { album }),
        }),
      );
      linkSent(ctx, chat, localId, sent.id);
      // A retried attempt may own this message now: only this run's own
      // success settles it, drops the timer and the kept bytes.
      if (!isCurrentSendRun(ctx, localId, run)) {
        return;
      }
      settleSendTimeout(ctx, localId, run);
      ctx.k.updateMessageStatus(chat.id, localId, 'sent');
      ctx.pendingAttachments.delete(localId);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          clearUploadProgress(ctx, chat.id, localId);
          // Keep the local bytes so the bubble can offer a Retry. Pre-timeout
          // code read only the `failed` flag; keep it in sync.
          settleFailure(ctx, chat.id, localId, run, cause, () =>
            ctx.k.markAttachmentFailed(chat.id, localId),
          );
        }),
      ),
    ),
  );
}

export function sendAttachment(
  ctx: SendCtx,
  chatId: string,
  file: unknown,
  options?: SendAttachmentOptions,
): string | undefined {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return undefined;
  }
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const caption = options?.caption?.trim() ?? '';
  const album = validAlbum(options?.album);
  const info = ctx.ports.bytes.describe(file);
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    createdAt: ctx.ports.now(),
    status: 'sending',
    attachment: {
      kind: info.kind,
      url: info.localUrl ?? '',
      name: info.name,
      size: info.size,
      mime: info.mime,
    },
    ...(caption.length === 0 ? {} : { text: caption }),
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(album === undefined ? {} : { album }),
  };
  clearActionError(ctx, chatId);
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, caption, wireReply(ctx, replyTo)), localId);
  ctx.k.setChatMessage(chatId, message, true);
  ctx.pendingAttachments.set(localId, file);
  rememberMyAuthor(ctx, localId);
  if (caption.length > 0) {
    ctx.k.rememberBaseText(localId, caption);
  }
  runAttachmentUpload(ctx, chat, localId, file, info, caption, replyTo, album);
  return localId;
}

export function retryAttachment(ctx: SendCtx, chatId: string, messageId: string): void {
  const root = ctx.k.aliasRoot(messageId);
  const file = ctx.pendingAttachments.get(root) ?? ctx.pendingAttachments.get(messageId);
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (file === undefined || chat === undefined) {
    return;
  }
  const message = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  // Like `retryVoice`: only a `failed` bubble may relaunch the pipeline, so a
  // double Retry click cannot double-send (the first click flips the bubble
  // back to `sending`, and the second returns here).
  if (message === undefined || message.status !== 'failed') {
    return;
  }
  ctx.k.markSendRetrying(chatId, messageId);
  runAttachmentUpload(
    ctx,
    chat,
    messageId,
    file,
    ctx.ports.bytes.describe(file),
    message.text ?? '',
    message.replyTo,
    validAlbum(message.album),
  );
}
