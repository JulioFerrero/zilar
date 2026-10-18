import { Effect } from 'effect';
import {
  deleteFailedMessage as deleteFailedMessageCore,
  disarmSend,
  forwardMessages as forwardMessagesCore,
  retryAttachment as retryAttachmentCore,
  retrySticker as retryStickerCore,
  retryText as retryTextCore,
  retryVoice as retryVoiceCore,
  sendAttachment as sendAttachmentCore,
  sendSticker as sendStickerCore,
  sendText as sendTextCore,
  sendTyping,
  sendVoice as sendVoiceCore,
  stopTyping,
  type SendCtx,
} from '@zilar/client-core/store';

import { MAX_ATTACHMENT_BYTES } from '../../lib/attachments';
import { validateRecording, voiceSendRefusalMessage, type RecordedVoice } from '../../lib/voice';
import type { ChatStoreState } from '../types';
import type { StoreCtx } from './runtime';

export type Send = Pick<
  ChatStoreState,
  | 'sendTyping'
  | 'stopTyping'
  | 'sendText'
  | 'sendSticker'
  | 'forwardMessages'
  | 'retrySticker'
  | 'retryText'
  | 'deleteFailedMessage'
  | 'sendAttachment'
  | 'retryAttachment'
  | 'cancelAttachment'
  | 'sendVoice'
  | 'retryVoice'
  | 'cancelVoice'
>;

export function makeSend(ctx: StoreCtx): Send {
  const { get, set, s, h, ports } = ctx;

  // The text outbox is one per store instance on the shared `coreCtx`: texts stay `sending` until the server's ack, and `teardown()` clears it on sign-out, so one user's queue never goes out as another user's.
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
    get outbox() {
      return ctx.coreCtx.outbox;
    },
    omitEmptyTextOptions: true,
  };

  // The local `file://` preview a mobile bubble shows while the bytes upload; no id means the send was refused, so there is no bubble to key.
  const markLocalUri = (chatId: string, messageId: string | undefined, uri: string): void => {
    if (messageId === undefined) {
      return;
    }
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

  // Aborts this message's in-flight PUT, removes the optimistic bubble and disarms the core run and its 60 s deadline, so the bytes are dropped and a later Retry is a no-op.
  const cancelSend = (chatId: string, messageId: string, pending: Map<string, unknown>): void => {
    ports.uploader?.cancel(h.aliasRoot(messageId));
    ports.uploader?.cancel(messageId);
    pending.delete(h.aliasRoot(messageId));
    pending.delete(messageId);
    disarmSend(sendCtx, messageId);
    removeBubble(chatId, messageId);
  };

  return {
    sendTyping: (chatId) => sendTyping(ctx.coreCtx, chatId),
    stopTyping: (chatId) => stopTyping(ctx.coreCtx, chatId),
    sendText: (chatId, text, options) => sendTextCore(sendCtx, chatId, text, options),
    sendSticker: (chatId, sticker, options) => sendStickerCore(sendCtx, chatId, sticker, options),
    forwardMessages: (targets, messages, options) =>
      forwardMessagesCore(sendCtx, targets, messages, options),
    retrySticker: (chatId, messageId) => retryStickerCore(sendCtx, chatId, messageId),
    retryText: (chatId, messageId) => retryTextCore(sendCtx, chatId, messageId),
    deleteFailedMessage: (chatId, messageId) => deleteFailedMessageCore(sendCtx, chatId, messageId),
    sendAttachment: (chatId, file, options) => {
      // An empty or oversized file is refused inline, before any request. Only a REAL zero says "That file is empty": an unknown size is never refused as empty.
      if (file.size !== undefined && file.size === 0) {
        set({ actionError: { chatId, message: 'That file is empty.' } });
        return;
      }
      if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
        set({ actionError: { chatId, message: 'That file is larger than 50 MB.' } });
        return;
      }
      const messageId = sendAttachmentCore(sendCtx, chatId, file, options);
      markLocalUri(chatId, messageId, file.uri);
    },
    retryAttachment: (chatId, messageId) => retryAttachmentCore(sendCtx, chatId, messageId),
    cancelAttachment: (chatId, messageId) => cancelSend(chatId, messageId, s.pendingUploads),
    sendVoice: (chatId, recording, options) => {
      // Refuse an over-limit recording before any optimistic bubble, slot request or PUT: the composer is not the only caller.
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
      const messageId = sendVoiceCore(
        sendCtx,
        chatId,
        { bytes: kept, durationMs, waveform, localUrl: recording.uri },
        options,
      );
      markLocalUri(chatId, messageId, recording.uri);
    },
    retryVoice: (chatId, messageId) => retryVoiceCore(sendCtx, chatId, messageId),
    cancelVoice: (chatId, messageId) => cancelSend(chatId, messageId, s.pendingVoices),
  };
}
