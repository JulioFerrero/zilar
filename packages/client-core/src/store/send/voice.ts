import { Effect } from 'effect';
import type { ChatSummary, ReplyRef, UiMessage, VoiceMeta } from '@zilar/chat-core';
import {
  clearActionError,
  clearUploadProgress,
  linkSent,
  nextLocalId,
  queueOutgoing,
  rememberMyAuthor,
  setUploadProgress,
} from './context';
import type { SendCtx, SendTextOptions } from './context';
import { fromPromise } from '../ctx';
import {
  armSendTimeout,
  isCurrentSendRun,
  messageAlive,
  newRun,
  settleFailure,
  settleSendTimeout,
} from './pipeline';
import type { VoiceInput } from '../ports';
import { coreKind } from '../rows';

/**
 * The voice pipeline, re-runnable from a Retry (T-0168): convert, PUT the
 * bytes, then send the payload message. Every failure — conversion, upload or
 * the final send — lands the bubble in `failed` with a fixed user-safe reason,
 * never a clock forever. The recording's bytes stay in `pendingVoices` until
 * the stanza send succeeds, so a Retry re-runs the same pipeline from the
 * retained bytes.
 */
function runVoiceSend(
  ctx: SendCtx,
  chat: ChatSummary,
  localId: string,
  input: VoiceInput,
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
      const converted = yield* ctx.ports.voice.convert(input);
      // A cancel during `convert` (or the upload below) removed the bubble: the
      // pipeline stops before it converts further, uploads or sends.
      if (!messageAlive(ctx, chat.id, localId)) {
        settleSendTimeout(ctx, localId, run);
        return;
      }
      const url = yield* ctx.ports.voice.upload(
        current,
        converted.audio,
        (fraction) => setUploadProgress(ctx, chat.id, localId, fraction),
        localId,
      );
      if (!messageAlive(ctx, chat.id, localId)) {
        settleSendTimeout(ctx, localId, run);
        return;
      }
      const voice: VoiceMeta = {
        duration_ms: converted.durationMs,
        mime: 'audio/mp4',
        waveform: input.waveform,
        url,
      };
      ctx.k.updateMessageVoice(chat.id, localId, voice);
      clearUploadProgress(ctx, chat.id, localId);
      const sent = yield* fromPromise(() =>
        current.sendMessage(chat.id, coreKind(chat), '', {
          payload: { v: 0, type: 'voice', data: voice },
          ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
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
      ctx.pendingVoices.delete(localId);
      ctx.pendingVoices.delete(ctx.k.aliasRoot(localId));
    }).pipe(
      // The optimistic bubble keeps its local audio; the failure shows
      // "Not sent" with Retry and Delete instead of a clock.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          clearUploadProgress(ctx, chat.id, localId);
          settleFailure(ctx, chat.id, localId, run, cause);
        }),
      ),
    ),
  );
}

export function sendVoice(
  ctx: SendCtx,
  chatId: string,
  recording: VoiceInput,
  options?: SendTextOptions,
): void {
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return;
  }
  const localId = nextLocalId(ctx);
  const replyTo = options?.replyTo;
  const durationMs = Math.max(1, recording.durationMs);
  const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
  const message: UiMessage = {
    id: localId,
    chatId,
    senderId: ctx.get().currentUserId,
    senderName: 'You',
    createdAt: ctx.ports.now(),
    status: 'sending',
    voice: {
      duration_ms: durationMs,
      mime: 'audio/mp4',
      waveform,
      ...(recording.localUrl === undefined ? {} : { url: recording.localUrl }),
    },
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  clearActionError(ctx, chatId);
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, '', replyTo), localId);
  ctx.k.setChatMessage(chatId, message, true);
  ctx.pendingVoices.set(localId, recording.bytes);
  rememberMyAuthor(ctx, localId);

  runVoiceSend(ctx, chat, localId, { ...recording, durationMs, waveform }, replyTo);
}

export function retryVoice(ctx: SendCtx, chatId: string, messageId: string): void {
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
  runVoiceSend(
    ctx,
    chat,
    messageId,
    {
      bytes: kept,
      durationMs: message.voice.duration_ms,
      waveform: message.voice.waveform,
      localUrl: message.voice.url,
    },
    message.replyTo,
  );
}
