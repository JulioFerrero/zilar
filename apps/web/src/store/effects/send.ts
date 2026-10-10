// The send pipeline lives in `@zilar/client-core/store` (T10). This file is the
// web binding: it maps web's `File`, `VoiceRecording` and `StoreCtx` onto the
// core functions and keeps the same export names.
import { Effect } from 'effect';
import {
  deleteFailedMessage as deleteFailedMessageCore,
  forwardMessages as forwardMessagesCore,
  retryAttachment as retryAttachmentCore,
  retrySticker as retryStickerCore,
  retryVoice as retryVoiceCore,
  sendAttachment as sendAttachmentCore,
  sendSticker as sendStickerCore,
  sendText as sendTextCore,
  sendVoice as sendVoiceCore,
} from '@zilar/client-core/store';
import type { UiMessage } from '@zilar/chat-core';
import type {
  SendAttachmentOptions,
  SendStickerInput,
  SendTextOptions,
  VoiceRecording,
} from '../store';
import type { StoreCtx } from './ctx';

// `URL.createObjectURL` is missing in some test environments.
const objectUrlFor = (blob: Blob): string | undefined =>
  Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );

export function sendText(
  ctx: StoreCtx,
  chatId: string,
  text: string,
  options?: SendTextOptions,
): void {
  sendTextCore(ctx, chatId, text, options);
}

export function sendVoice(
  ctx: StoreCtx,
  chatId: string,
  recording: VoiceRecording,
  options?: SendTextOptions,
): void {
  // R19: the empty-recording check stays in the web facade.
  if (recording.blob.size === 0) {
    return;
  }
  sendVoiceCore(
    ctx,
    chatId,
    {
      bytes: recording.blob,
      durationMs: recording.durationMs,
      waveform: recording.waveform,
      localUrl: objectUrlFor(recording.blob),
    },
    options,
  );
}

export function retryVoice(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryVoiceCore(ctx, chatId, messageId);
}

export function deleteFailedMessage(ctx: StoreCtx, chatId: string, messageId: string): void {
  deleteFailedMessageCore(ctx, chatId, messageId);
}

export function sendAttachment(
  ctx: StoreCtx,
  chatId: string,
  file: File,
  options?: SendAttachmentOptions,
): void {
  // R19: an empty file is refused silently by the web facade, before any
  // request or optimistic bubble (mobile shows an inline banner instead).
  if (file.size === 0) {
    return;
  }
  sendAttachmentCore(ctx, chatId, file, options);
}

export function sendSticker(
  ctx: StoreCtx,
  chatId: string,
  sticker: SendStickerInput,
  options?: SendTextOptions,
): void {
  sendStickerCore(ctx, chatId, sticker, options);
}

export function forwardMessages(
  ctx: StoreCtx,
  targets: string[],
  messages: UiMessage[],
  options?: { comment?: string },
): void {
  forwardMessagesCore(ctx, targets, messages, options);
}

export function retrySticker(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryStickerCore(ctx, chatId, messageId);
}

export function retryAttachment(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryAttachmentCore(ctx, chatId, messageId);
}
