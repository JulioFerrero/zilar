// The send pipeline lives in `@zilar/client-core/store` (T10). This file is the
// mobile binding: it keeps mobile's inline input validation (R19) and its
// cancel actions, maps the mobile `StoreCtx` onto the core `SendCtx`, and keeps
// the mobile-only optimistic fields (`localUri`).
import { Effect } from 'effect';
import {
  disarmSend,
  forwardMessages as forwardMessagesCore,
  retryAttachment as retryAttachmentCore,
  retrySticker as retryStickerCore,
  retryVoice as retryVoiceCore,
  sendAttachment as sendAttachmentCore,
  sendSticker as sendStickerCore,
  sendText as sendTextCore,
  sendTyping,
  sendVoice as sendVoiceCore,
  type SendCtx,
} from '@zilar/client-core/store';

import { MAX_ATTACHMENT_BYTES } from '../../lib/attachments';
import { validateRecording, voiceSendRefusalMessage, type RecordedVoice } from '../../lib/voice';
import type { ChatStoreState } from '../types';
import type { StoreCtx } from './runtime';

export type Send = Pick<
  ChatStoreState,
  | 'sendTyping'
  | 'sendText'
  | 'sendSticker'
  | 'forwardMessages'
  | 'retrySticker'
  | 'sendAttachment'
  | 'retryAttachment'
  | 'cancelAttachment'
  | 'sendVoice'
  | 'retryVoice'
  | 'cancelVoice'
>;

/**
 * Everything the user sends: text, stickers, forwards, attachments and voice
 * messages, and the Retry and cancel of the ones that fail. The pipeline, the
 * 60 s deadline, the failed shape and the sticker-retry rule are the core's;
 * this binding keeps the inline validation (R19) and the mobile cancel.
 */
export function makeSend(ctx: StoreCtx): Send {
  const { get, set, s, h, ports } = ctx;

  // The same store as the core modules see it, plus the send bookkeeping. The
  // sequence and the open runs live on the shared `StoreState`; the kept bytes
  // are the maps mobile already tears down on `stop()`.
  const sendCtx: SendCtx = {
    get,
    set,
    ports: { ...ctx.coreCtx.ports, bytes: ports.bytes, voice: ports.voice },
    rt: ctx.life.lifetime,
    k: ctx.coreCtx.k,
    fx: ctx.coreCtx.fx,
    get core() {
      return ctx.coreCtx.core;
    },
    set core(value) {
      ctx.coreCtx.core = value;
    },
    lastRead: ctx.coreCtx.lastRead,
    lastReadUserId: ctx.coreCtx.lastReadUserId,
    pendingOutgoing: ctx.coreCtx.pendingOutgoing,
    get sequence() {
      return s.sequence;
    },
    set sequence(value) {
      s.sequence = value;
    },
    sendRuns: s.sendRuns,
    pendingAttachments: s.pendingUploads as Map<string, unknown>,
    pendingVoices: s.pendingVoices as Map<string, unknown>,
    // Mobile sends `undefined` options for a plain text; web pins `{}`.
    omitEmptyTextOptions: true,
  };

  // The local `file://` preview a mobile bubble shows while the bytes upload.
  // The core inserts the optimistic message, so the binding keys it by the id
  // the core just minted; `before` is the sequence captured before the call.
  const markLocalUri = (chatId: string, uri: string, before: number): void => {
    if (s.sequence === before) {
      return;
    }
    const messageId = `local-${s.sequence}`;
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: h
          .listFor(state, chatId)
          .map((item) => (h.sameMessage(item.id, messageId) ? { ...item, localUri: uri } : item)),
      },
    }));
  };

  const removeBubble = (chatId: string, messageId: string): void => {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: h.listFor(state, chatId).filter((item) => !h.sameMessage(item.id, messageId)),
      },
    }));
  };

  return {
    sendTyping: (chatId) => sendTyping(ctx.coreCtx, chatId),
    sendText: (chatId, text, options) => sendTextCore(sendCtx, chatId, text, options),
    sendSticker: (chatId, sticker, options) => sendStickerCore(sendCtx, chatId, sticker, options),
    forwardMessages: (targets, messages, options) =>
      forwardMessagesCore(sendCtx, targets, messages, options),
    retrySticker: (chatId, messageId) => retryStickerCore(sendCtx, chatId, messageId),
    sendAttachment: (chatId, file, options) => {
      // R19: an empty or oversized file is refused inline, before any request,
      // exactly like web's composer. Only a REAL zero says "That file is
      // empty": an unknown size is never refused as empty — the upload decides.
      if (file.size !== undefined && file.size === 0) {
        set({ actionError: { chatId, message: 'That file is empty.' } });
        return;
      }
      if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
        set({ actionError: { chatId, message: 'That file is larger than 50 MB.' } });
        return;
      }
      const before = s.sequence;
      sendAttachmentCore(sendCtx, chatId, file, options);
      markLocalUri(chatId, file.uri, before);
    },
    retryAttachment: (chatId, messageId) => retryAttachmentCore(sendCtx, chatId, messageId),
    cancelAttachment: (chatId, messageId) => {
      // Cancelling aborts this message's in-flight PUT, removes the optimistic
      // bubble, and disarms the core run and its 60 s deadline so a pipeline
      // still awaiting its slot request or PUT sends nothing. The bytes are
      // dropped, so a later Retry is a no-op.
      ports.uploader?.cancel(h.aliasRoot(messageId));
      ports.uploader?.cancel(messageId);
      s.pendingUploads.delete(h.aliasRoot(messageId));
      s.pendingUploads.delete(messageId);
      disarmSend(sendCtx, messageId);
      removeBubble(chatId, messageId);
    },
    sendVoice: (chatId, recording, options) => {
      // R19 (finding 1, review round 2): refuse an over-limit recording here,
      // before any optimistic bubble, slot request or PUT — the composer is
      // not the only caller. The banner names the actual refusal.
      const refusal = Effect.runSync(
        Effect.try({ try: () => validateRecording(recording), catch: (error) => error }).pipe(
          Effect.as(undefined),
          Effect.catch((error) => Effect.succeed({ error })),
        ),
      );
      if (refusal !== undefined) {
        set({ actionError: { chatId, message: voiceSendRefusalMessage(refusal.error) } });
        return;
      }
      const durationMs = Math.max(1, Math.round(recording.durationMs));
      const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
      const kept: RecordedVoice = {
        uri: recording.uri,
        mimeType: recording.mimeType,
        size: recording.size,
        durationMs,
      };
      const before = s.sequence;
      sendVoiceCore(
        sendCtx,
        chatId,
        { bytes: kept, durationMs, waveform, localUrl: recording.uri },
        options,
      );
      markLocalUri(chatId, recording.uri, before);
    },
    retryVoice: (chatId, messageId) => retryVoiceCore(sendCtx, chatId, messageId),
    cancelVoice: (chatId, messageId) => {
      // Cancelling aborts this message's in-flight PUT, removes the optimistic
      // bubble, and disarms the core run and its 60 s deadline so a pipeline
      // still converting or uploading sends nothing. The recording is dropped,
      // so a later Retry is a no-op. The uploader keys controllers per message
      // id.
      ports.uploader?.cancel(h.aliasRoot(messageId));
      ports.uploader?.cancel(messageId);
      s.pendingVoices.delete(h.aliasRoot(messageId));
      s.pendingVoices.delete(messageId);
      disarmSend(sendCtx, messageId);
      removeBubble(chatId, messageId);
    },
  };
}
