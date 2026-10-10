import { Effect } from 'effect';
import { mentionsForTrimmedText, type UiMessage } from '@zilar/chat-core';
import { linkSent, nextLocalId, queueOutgoing, rememberMyAuthor } from './context';
import type { SendCtx, SendTextOptions } from './context';
import { fromPromise } from '../ctx';
import { coreKind } from '../rows';

export function sendText(
  ctx: SendCtx,
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
  // The core passes `{}` for a plain text (web's pinned shape); mobile sets
  // `omitEmptyTextOptions` so its plain texts stay `undefined`.
  const sendOptions =
    replyTo === undefined && mentions.length === 0 && ctx.omitEmptyTextOptions === true
      ? undefined
      : {
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
        };
  return void ctx.rt.fork(
    fromPromise(() => current.sendMessage(chatId, coreKind(chat), trimmed, sendOptions)).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, chat, localId, sent.id);
          ctx.k.updateMessageStatus(chatId, localId, 'sent');
        }),
      ),
      // The message stays marked as sending; a reconnect can resend later.
      Effect.catchCause(() => Effect.void),
    ),
  );
}
