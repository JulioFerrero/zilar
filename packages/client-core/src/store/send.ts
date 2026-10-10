// Sending: text, voice, attachments, stickers and forwards, with the retry and
// delete paths of a failed bubble. Each send inserts an optimistic bubble at
// once, then runs the pipeline as a fiber of the store Scope. A voice,
// attachment or forward send also gets a 60 s deadline (`timeoutOrElse`) that
// marks it failed with `timed_out`; the run token pairs each deadline with its
// pipeline, so a retry's deadline and a previous run's late result agree on
// which outcome counts.
//
// The pipeline reads the app's `bytes` and `voice` ports (`SendPorts`); the
// text, sticker and forward shapes are shared verbatim. Text sends keep their
// behaviour (D-1): a failed text stays `sending`.
//
// This is the barrel: the pieces live in `send/context.ts`, `send/pipeline.ts`,
// `send/text.ts`, `send/voice.ts`, `send/attachment.ts`, `send/sticker.ts`,
// `send/forward.ts` and `send/failed.ts`, and are assembled here. Moved
// unchanged from the former single file (size split).
export type {
  SendAttachmentOptions,
  SendCtx,
  SendRun,
  SendStickerInput,
  SendTextOptions,
} from './send/context';
export { deleteFailedMessage } from './send/failed';
export { forwardMessages } from './send/forward';
export { disarmSend, SEND_TIMEOUT_MS } from './send/pipeline';
export { retrySticker, sendSticker } from './send/sticker';
export { sendText } from './send/text';
export { retryAttachment, sendAttachment } from './send/attachment';
export { retryVoice, sendVoice } from './send/voice';
