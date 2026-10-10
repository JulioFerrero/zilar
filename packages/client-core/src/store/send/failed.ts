import type { SendCtx } from './context';
import { disarmSend } from './pipeline';

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
