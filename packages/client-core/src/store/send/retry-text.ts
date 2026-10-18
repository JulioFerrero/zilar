import { Effect } from 'effect';
import type { ChatSummary, UiMention } from '@zilar/chat-core';
import type { SendMessageOptions } from '@zilar/xmpp-core';
import { linkSent } from './context';
import type { SendCtx } from './context';
import { fromPromise } from '../ctx';
import { coreKind } from '../rows';
import { outboxFailed } from './outbox';

// Rebuilds the options of the original `sendText` from a failed bubble: the reply target
// resolves to the wire id both sides share, or is dropped until known; mentions are the
// stored offsets.
function retryTextOptions(
  ctx: SendCtx,
  message: { replyTo?: { id: string; text?: string } | undefined; mentions?: readonly UiMention[] },
): SendMessageOptions | undefined {
  const replyTo = message.replyTo;
  const mentions = message.mentions ?? [];
  const wireReplyId =
    replyTo === undefined ? undefined : (ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id);
  if (wireReplyId === undefined && mentions.length === 0) {
    return undefined;
  }
  return {
    ...(wireReplyId === undefined
      ? {}
      : {
          replyTo: {
            id: wireReplyId,
            ...(replyTo?.text === undefined ? {} : { text: replyTo.text }),
          },
        }),
    ...(mentions.length === 0
      ? {}
      : {
          mentions: mentions.map((mention) => ({
            jid: mention.jid,
            begin: mention.begin,
            end: mention.end,
          })),
        }),
  };
}

// One resend under the same stanza id, so the echo path dedupes it and the receiver sees
// it once. A failure re-arms the outbox entry; the ack or the echo settles the bubble.
export function retryText(ctx: SendCtx, chatId: string, messageId: string): void {
  const chat: ChatSummary | undefined = ctx.get().chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return;
  }
  const message = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  // Only a failed own text may relaunch, so a double Retry click cannot double-send;
  // attachments, stickers, voice notes and images keep their own retry paths.
  if (
    message === undefined ||
    message.status !== 'failed' ||
    message.text === undefined ||
    message.senderId !== ctx.get().currentUserId ||
    message.voice !== undefined ||
    message.attachment !== undefined ||
    message.image !== undefined ||
    message.card !== undefined
  ) {
    return;
  }
  const current = ctx.core;
  ctx.k.markSendRetrying(chatId, messageId);
  const text = message.text;
  const options = retryTextOptions(ctx, message);
  if (current === undefined) {
    // No core yet: queue the text anyway, so the next online resends it instead of
    // leaving the bubble `sending` for good.
    if (ctx.outbox !== undefined) {
      outboxFailed(
        ctx,
        chatId,
        messageId,
        text,
        options?.replyTo?.id,
        options?.replyTo?.text,
        message.mentions ?? [],
        undefined,
        ctx.ports.now().getTime(),
      );
    }
    return;
  }
  // The same message id the bubble already carries, so the echo path dedupes it. Unlike a
  // first mobile send, a retry always names the id.
  const sendOptions: SendMessageOptions = { ...options, id: messageId };
  ctx.rt.fork(
    fromPromise(() => current.sendMessage(chatId, coreKind(chat), text, sendOptions)).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, chat, messageId, sent.id);
          if (ctx.outbox !== undefined) {
            outboxFailed(
              ctx,
              chatId,
              messageId,
              text,
              options?.replyTo?.id,
              options?.replyTo?.text,
              message.mentions ?? [],
              sent.id,
              ctx.ports.now().getTime(),
            );
          }
        }),
      ),
      Effect.catchCause(() =>
        Effect.sync(() => {
          if (ctx.outbox !== undefined) {
            outboxFailed(
              ctx,
              chatId,
              messageId,
              text,
              options?.replyTo?.id,
              options?.replyTo?.text,
              message.mentions ?? [],
              undefined,
              ctx.ports.now().getTime(),
            );
          }
        }),
      ),
    ),
  );
}
