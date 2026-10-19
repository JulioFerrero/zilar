// Sending: text, voice, attachments, stickers and forwards, plus the retry and delete paths
// of a failed bubble. Each send inserts an optimistic bubble at once, then runs the pipeline
// as a store fiber; a voice, attachment or forward send also gets a 60 s deadline whose run
// token pairs it with its pipeline, so a retry's deadline and an older run's late result
// agree on which outcome counts.
import type { SendCtx } from './send/context';
import { disarmSend } from './send/pipeline';

export type {
  SendAttachmentOptions,
  SendCtx,
  SendRun,
  SendStickerInput,
  SendTextOptions,
} from './send/context';

export function deleteFailedMessage(ctx: SendCtx, chatId: string, messageId: string): void {
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
  disarmSend(ctx, messageId);
  ctx.k.removeFailedMessage(chatId, messageId);
}
