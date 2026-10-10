// Sending: text, voice, attachments, stickers and forwards, with the retry and
// delete paths of a failed bubble. Each send inserts an optimistic bubble at
// once, then runs the pipeline as a fiber of the store Scope. A voice,
// attachment or forward send also gets a 60 s deadline (`timeoutOrElse`) that
// marks it failed with `timed_out`; the run token pairs each deadline with its
// pipeline, so a retry's deadline and a previous run's late result agree on
// which outcome counts.
import { Cause, Deferred, Effect } from 'effect';
import {
  forwardedPayloadFor,
  forwardedUiFieldsFor,
  mentionsForTrimmedText,
  type Attachment,
  type ChatSummary,
  type ReplyRef,
  type UiMessage,
  type VoiceMeta,
} from '@zilar/chat-core';
import type { ForwardOrigin, Payload } from '@zilar/protocol';
import { ForwardOriginSchema, StickerSchema, isValid } from '@zilar/protocol';
import { cleanFilename } from '@/lib/attachments';
import type {
  SendAttachmentOptions,
  SendStickerInput,
  SendTextOptions,
  VoiceRecording,
} from '../store';
import { clearFailure, coreKind } from './chatRows';
import { SEND_TIMEOUT_MS } from './constants';
import type { SendRun, StoreCtx } from './ctx';
import { Ports } from './ports';
import { sendFailureReasonFor } from './sendFailure';
import { fromPromise } from './util';

const newRun = (): SendRun => ({ settled: Deferred.makeUnsafe<void>() });

const timeoutKey = (root: string): string => `send-timeout:${root}`;

// `URL.createObjectURL` is missing in some test environments.
const objectUrlFor = (blob: Blob): string | undefined =>
  Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );

const nextLocalId = (ctx: StoreCtx): string => {
  ctx.sequence += 1;
  return `local-${ctx.sequence}`;
};

// Queues the optimistic id under the signature the server echo will carry.
const queueOutgoing = (ctx: StoreCtx, signature: string, localId: string): void => {
  const queue = ctx.pendingOutgoing.get(signature) ?? [];
  queue.push(localId);
  ctx.pendingOutgoing.set(signature, queue);
};

const rememberMyAuthor = (ctx: StoreCtx, localId: string): void => {
  const mine = ctx.k.myJid();
  if (mine !== undefined) {
    ctx.k.rememberAuthor(localId, { jid: mine, resolved: true });
  }
};

// One send attempt's deadline (T-0168): when it passes while the message is
// still `sending`, the send is marked `failed` with `timed_out` and the
// pipeline's late result is ignored. A new attempt for the same message
// replaces the watcher of the previous one. The watchers live in the store
// Scope, so `stop()` drops them.
function armSendTimeout(ctx: StoreCtx, chatId: string, messageId: string, run: SendRun): void {
  const key = ctx.k.aliasRoot(messageId);
  ctx.sendRuns.set(key, run);
  ctx.rt.forkKeyed(
    timeoutKey(key),
    Deferred.await(run.settled).pipe(
      Effect.timeoutOrElse({
        duration: SEND_TIMEOUT_MS,
        orElse: () =>
          Effect.sync(() => {
            if (ctx.sendRuns.get(key) !== run) {
              return;
            }
            ctx.sendRuns.delete(key);
            ctx.k.markSendFailed(chatId, messageId, 'timed_out');
          }),
      }),
    ),
  );
}

// The pipeline settled this run: drop its watcher without firing, so a late
// success after a manual failure (or the reverse) cannot flip the message.
function settleSendTimeout(ctx: StoreCtx, messageId: string, run: SendRun): void {
  const key = ctx.k.aliasRoot(messageId);
  if (ctx.sendRuns.get(key) !== run) {
    return;
  }
  Deferred.doneUnsafe(run.settled, Effect.void);
  ctx.sendRuns.delete(key);
}

// Whether `run` is still the current send attempt for `messageId`: a retry
// arms a new run for the same message, and the older pipeline's late success
// or failure must then ignore itself instead of flipping a bubble another
// attempt owns.
const isCurrentSendRun = (ctx: StoreCtx, messageId: string, run: SendRun): boolean =>
  ctx.sendRuns.get(ctx.k.aliasRoot(messageId)) === run;

// What a stanza send that succeeded changes: the ids are linked even when a
// retry owns the message now.
const linkSent = (ctx: StoreCtx, localId: string, serverId: string): void => {
  ctx.k.linkMessageIds(localId, serverId);
  ctx.k.linkLocalToServer(localId, serverId);
  ctx.k.rememberOriginId(localId, serverId);
};

/** The send step of a sticker, re-runnable from a Retry: only the stanza is (re)sent. */
function runStickerSend(
  ctx: StoreCtx,
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
          linkSent(ctx, localId, sent.id);
          ctx.k.updateMessageStatus(chat.id, localId, 'sent');
        }),
      ),
      Effect.catchCause(() => Effect.sync(() => ctx.k.markStickerFailed(chat.id, localId))),
    ),
  );
}

// The settle step shared by the pipelines below: a run that lost the message
// to a retry changes nothing.
const settleFailure = (
  ctx: StoreCtx,
  chatId: string,
  localId: string,
  run: SendRun,
  cause: Cause.Cause<unknown>,
  after?: () => void,
): void => {
  // Same staleness rule on failure: a previous run racing a live retry must
  // not flip the bubble the retry owns.
  if (!isCurrentSendRun(ctx, localId, run)) {
    return;
  }
  settleSendTimeout(ctx, localId, run);
  ctx.k.markSendFailed(chatId, localId, sendFailureReasonFor(Cause.squash(cause), false));
  after?.();
};

/**
 * The upload steps of an attachment, re-runnable from a Retry: read the image
 * size when it is one, PUT the bytes, then send the payload message.
 */
function runAttachmentUpload(
  ctx: StoreCtx,
  chat: ChatSummary,
  localId: string,
  file: File,
  caption: string,
  replyTo: ReplyRef | undefined,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markSendFailed(chat.id, localId, 'network');
    return;
  }
  const run = newRun();
  armSendTimeout(ctx, chat.id, localId, run);
  ctx.rt.fork(
    Effect.gen(function* () {
      const { attachments } = yield* Ports;
      const kind = attachments.classify(file);
      const measured =
        kind === 'image' ? yield* fromPromise(() => attachments.readImageSize(file)) : undefined;
      const url = yield* fromPromise(() => attachments.upload(current, file));
      const data: Attachment = {
        kind,
        url,
        name: cleanFilename(file.name),
        size: file.size,
        mime: file.type === '' ? 'application/octet-stream' : file.type,
        ...(measured === undefined ? {} : { width: measured.width, height: measured.height }),
      };
      ctx.k.updateMessageAttachment(chat.id, localId, data);
      const sent = yield* fromPromise(() =>
        current.sendMessage(chat.id, coreKind(chat), caption, {
          payload: { v: 0, type: 'attachment', data },
          ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
        }),
      );
      linkSent(ctx, localId, sent.id);
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
        Effect.sync(() =>
          // Keep the local bytes so the bubble can offer a Retry. Pre-timeout
          // code read only the `failed` flag; keep it in sync.
          settleFailure(ctx, chat.id, localId, run, cause, () =>
            ctx.k.markAttachmentFailed(chat.id, localId),
          ),
        ),
      ),
    ),
  );
}

/**
 * The voice pipeline, re-runnable from a Retry (T-0168): convert, PUT the
 * bytes, then send the payload message. Every failure — conversion, upload or
 * the final send — lands the bubble in `failed` with a fixed user-safe reason,
 * never a clock forever. The recording's bytes stay in `pendingVoices` until
 * the stanza send succeeds, so a Retry re-runs the same pipeline from the
 * retained blob.
 */
function runVoiceSend(
  ctx: StoreCtx,
  chat: ChatSummary,
  localId: string,
  blob: Blob,
  waveform: number[],
  replyTo: ReplyRef | undefined,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markSendFailed(chat.id, localId, 'network');
    return;
  }
  const run = newRun();
  armSendTimeout(ctx, chat.id, localId, run);
  ctx.rt.fork(
    Effect.gen(function* () {
      const { voice: voicePort } = yield* Ports;
      const converted = yield* fromPromise(() => voicePort.convert(blob));
      const url = yield* fromPromise(() => voicePort.upload(current, converted.audio));
      const voice: VoiceMeta = {
        duration_ms: converted.durationMs,
        mime: 'audio/mp4',
        waveform,
        url,
      };
      ctx.k.updateMessageVoice(chat.id, localId, voice);
      const sent = yield* fromPromise(() =>
        current.sendMessage(chat.id, coreKind(chat), '', {
          payload: { v: 0, type: 'voice', data: voice },
          ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
        }),
      );
      linkSent(ctx, localId, sent.id);
      // A retried attempt may own this message now: only this run's own
      // success settles it, drops the timer and the kept bytes.
      if (!isCurrentSendRun(ctx, localId, run)) {
        return;
      }
      settleSendTimeout(ctx, localId, run);
      ctx.k.updateMessageStatus(chat.id, localId, 'sent');
      ctx.pendingVoices.delete(localId);
      ctx.pendingVoices.delete(ctx.k.aliasRoot(localId));
    }).pipe(
      // The optimistic bubble keeps its local audio; the failure shows
      // "Not sent" with Retry and Delete instead of a clock.
      Effect.catchCause((cause) =>
        Effect.sync(() => settleFailure(ctx, chat.id, localId, run, cause)),
      ),
    ),
  );
}

// The room identity a forward may carry (T-0414): only a public group or
// topic has a room JID safe to reveal. A DM/AI chat has no room JID, and a
// private topic (or private group) must omit both so the target never learns a
// room it may not see (forwarding plan §3.1/§3.6).
function forwardPublicRoomFor(source: ChatSummary | undefined): ChatSummary | undefined {
  if (source === undefined || source.kind !== 'group') {
    return undefined;
  }
  const visibility = source.topic?.visibility ?? source.visibility;
  return visibility === 'public' ? source : undefined;
}

// The origin header of one forwarded copy. Reusing a message's own `forward`
// keeps the first author on a forward of a forward. Otherwise it is built from
// the source message; `ForwardOriginSchema` caps over-long names and rejects a
// bad timestamp, and such a message is skipped instead of putting junk on the
// wire.
function forwardOriginFor(ctx: StoreCtx, message: UiMessage): ForwardOrigin | undefined {
  if (message.forward !== undefined) {
    return isValid(ForwardOriginSchema)(message.forward) ? message.forward : undefined;
  }
  const createdAt = message.createdAt.getTime();
  if (Number.isNaN(createdAt)) {
    return undefined;
  }
  const author = ctx.k.authorFor(message.id);
  const room = forwardPublicRoomFor(ctx.get().chats.find((entry) => entry.id === message.chatId));
  const originalId = ctx.k.correctionTargetFor(message.id);
  const candidate = {
    sender_id: author?.jid ?? message.senderId,
    sender_name: message.senderName,
    ...(room === undefined ? {} : { chat_id: room.id, chat_name: room.title }),
    ...(originalId === undefined ? {} : { original_id: originalId }),
    original_at: new Date(createdAt).toISOString(),
  };
  return isValid(ForwardOriginSchema)(candidate) ? candidate : undefined;
}

// One forwarded copy's send: the same deadline/status machinery as voice and
// attachments, with a fixed user-safe reason on failure.
function runForwardSend(
  ctx: StoreCtx,
  target: ChatSummary,
  localId: string,
  body: string,
  payload: Payload | undefined,
  origin: ForwardOrigin,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markSendFailed(target.id, localId, 'network');
    return;
  }
  const run = newRun();
  armSendTimeout(ctx, target.id, localId, run);
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(target.id, coreKind(target), body, {
        ...(payload === undefined ? {} : { payload }),
        forward: origin,
      }),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, localId, sent.id);
          if (!isCurrentSendRun(ctx, localId, run)) {
            return;
          }
          settleSendTimeout(ctx, localId, run);
          ctx.k.updateMessageStatus(target.id, localId, 'sent');
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => settleFailure(ctx, target.id, localId, run, cause)),
      ),
    ),
  );
}

export function sendText(
  ctx: StoreCtx,
  chatId: string,
  text: string,
  options?: SendTextOptions,
): void {
  const trimmed = text.trim();
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (trimmed.length === 0 || chat === undefined) {
    return;
  }
  const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    text: trimmed,
    createdAt: ctx.ports.now(),
    status: 'sending',
    ...(mentions.length === 0 ? {} : { mentions }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, trimmed, replyTo), localId);
  ctx.k.setChatMessage(chatId, message, true);
  rememberMyAuthor(ctx, localId);
  ctx.k.rememberBaseText(localId, trimmed);

  const current = ctx.core;
  if (current === undefined) {
    return;
  }
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(chatId, coreKind(chat), trimmed, {
        ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
        ...(mentions.length === 0
          ? {}
          : {
              mentions: mentions.map((mention) => ({
                jid: mention.jid,
                begin: mention.begin,
                end: mention.end,
              })),
            }),
      }),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, localId, sent.id);
          ctx.k.updateMessageStatus(chatId, localId, 'sent');
        }),
      ),
      // The message stays marked as sending; a reconnect can resend later.
      Effect.catchCause(() => Effect.void),
    ),
  );
}

export function sendVoice(
  ctx: StoreCtx,
  chatId: string,
  recording: VoiceRecording,
  options?: SendTextOptions,
): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined || recording.blob.size === 0) {
    return;
  }
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const localUrl = objectUrlFor(recording.blob);
  const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    createdAt: ctx.ports.now(),
    status: 'sending',
    voice: {
      duration_ms: Math.max(1, recording.durationMs),
      mime: 'audio/mp4',
      waveform,
      ...(localUrl === undefined ? {} : { url: localUrl }),
    },
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, '', replyTo), localId);
  ctx.k.setChatMessage(chatId, message, true);
  ctx.pendingVoices.set(localId, { blob: recording.blob, waveform });
  rememberMyAuthor(ctx, localId);

  runVoiceSend(ctx, chat, localId, recording.blob, waveform, replyTo);
}

export function retryVoice(ctx: StoreCtx, chatId: string, messageId: string): void {
  const root = ctx.k.aliasRoot(messageId);
  const kept = ctx.pendingVoices.get(root) ?? ctx.pendingVoices.get(messageId);
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (kept === undefined || chat === undefined) {
    return;
  }
  const message = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  if (message === undefined || message.status !== 'failed' || message.voice === undefined) {
    return;
  }
  ctx.k.markSendRetrying(chatId, messageId);
  runVoiceSend(ctx, chat, messageId, kept.blob, kept.waveform, message.replyTo);
}

export function deleteFailedMessage(ctx: StoreCtx, chatId: string, messageId: string): void {
  const message = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  if (message === undefined || message.status !== 'failed') {
    return;
  }
  if (message.voice !== undefined) {
    ctx.pendingVoices.delete(ctx.k.aliasRoot(messageId));
    ctx.pendingVoices.delete(messageId);
  }
  const root = ctx.k.aliasRoot(messageId);
  if (ctx.sendRuns.has(root)) {
    ctx.rt.cancel(timeoutKey(root));
    ctx.sendRuns.delete(root);
  }
  ctx.k.removeFailedMessage(chatId, messageId);
}

export function sendAttachment(
  ctx: StoreCtx,
  chatId: string,
  file: File,
  options?: SendAttachmentOptions,
): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined || file.size === 0) {
    return;
  }
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const caption = options?.caption?.trim() ?? '';
  const kind = ctx.ports.attachments.classify(file);
  const mime = file.type === '' ? 'application/octet-stream' : file.type;
  const localUrl = kind === 'image' ? objectUrlFor(file) : undefined;
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    createdAt: ctx.ports.now(),
    status: 'sending',
    attachment: {
      kind,
      url: localUrl ?? '',
      name: cleanFilename(file.name),
      size: file.size,
      mime,
    },
    ...(caption.length === 0 ? {} : { text: caption }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, caption, replyTo), localId);
  ctx.k.setChatMessage(chatId, message, true);
  ctx.pendingAttachments.set(localId, file);
  rememberMyAuthor(ctx, localId);
  if (caption.length > 0) {
    ctx.k.rememberBaseText(localId, caption);
  }
  runAttachmentUpload(ctx, chat, localId, file, caption, replyTo);
}

export function sendSticker(
  ctx: StoreCtx,
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

export function forwardMessages(
  ctx: StoreCtx,
  targets: string[],
  messages: UiMessage[],
  options?: { comment?: string },
): void {
  const comment = options?.comment?.trim();
  const visited = new Set<string>();
  for (const targetId of targets) {
    if (visited.has(targetId)) {
      continue;
    }
    visited.add(targetId);
    const target = ctx.get().chats.find((entry) => entry.id === targetId);
    if (target === undefined) {
      continue;
    }
    let queued = false;
    for (const message of messages) {
      if (
        message.deleted === true ||
        message.failed === true ||
        message.status === 'failed' ||
        message.status === 'sending'
      ) {
        continue;
      }
      const origin = forwardOriginFor(ctx, message);
      if (origin === undefined) {
        continue;
      }
      const payload = forwardedPayloadFor(message);
      const body = message.text ?? '';
      if (body.length === 0 && payload === undefined) {
        continue;
      }
      const localId = nextLocalId(ctx);
      const copy: UiMessage = {
        id: localId,
        chatId: targetId,
        senderId: ctx.get().currentUserId,
        senderName: 'You',
        createdAt: ctx.ports.now(),
        status: 'sending',
        forward: origin,
        ...(body.length === 0 ? {} : { text: body }),
        ...(payload === undefined ? {} : forwardedUiFieldsFor(payload)),
      };
      // Key the echo queue exactly as the matching normal send does, so the
      // server echo links to this bubble instead of duplicating it.
      const signature =
        payload !== undefined && payload.type === 'sticker'
          ? ctx.k.stickerSignatureFor(targetId, body, payload.data.sticker_id, undefined)
          : ctx.k.signatureFor(targetId, body, undefined);
      queueOutgoing(ctx, signature, localId);
      ctx.k.setChatMessage(targetId, copy, true);
      rememberMyAuthor(ctx, localId);
      if (body.length > 0) {
        ctx.k.rememberBaseText(localId, body);
      }
      queued = true;
      runForwardSend(ctx, target, localId, body, payload, origin);
    }
    // The comment is a separate normal text message, only when this target
    // received at least one copy.
    if (queued && comment !== undefined && comment.length > 0) {
      ctx.get().sendText(targetId, comment);
    }
  }
}

export function retrySticker(ctx: StoreCtx, chatId: string, messageId: string): void {
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
  ctx.set((state) => ({
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: ctx.k
        .listFor(state, chatId)
        .map((item) => (ctx.k.sameMessage(item.id, messageId) ? clearFailure(item) : item)),
    },
  }));
  runStickerSend(ctx, chat, messageId, payload, message.text ?? '', message.replyTo);
}

export function retryAttachment(ctx: StoreCtx, chatId: string, messageId: string): void {
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
  runAttachmentUpload(ctx, chat, messageId, file, message.text ?? '', message.replyTo);
}
