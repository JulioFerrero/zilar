import { Effect } from 'effect';
import { mentionsForTrimmedText, type UiMessage } from '@zilar/chat-core';
import { linkSent, nextLocalId, queueOutgoing, rememberMyAuthor } from './context';
import type { SendCtx, SendTextOptions } from './context';
import { fromPromise } from '../ctx';
import { coreKind } from '../rows';
import { outboxAcked, outboxFailed, outboxUnacked } from './outbox';

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
  // A reply names the id both sides share: the wire id the reactions path
  // already computes (the origin id in a DM, the room stanza-id in a group),
  // falling back to the local id when it is not known yet. The echo carries
  // this same id, so the signature below is keyed on it too.
  const wireReply =
    replyTo === undefined
      ? undefined
      : { ...replyTo, id: ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id };
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
  queueOutgoing(ctx, ctx.k.signatureFor(chatId, trimmed, wireReply), localId);
  ctx.k.setChatMessage(chatId, message, true);
  rememberMyAuthor(ctx, localId);
  ctx.k.rememberBaseText(localId, trimmed);

  const current = ctx.core;
  if (current === undefined) {
    // No core yet (boot in flight, or a failed token): queue the text anyway,
    // so the next online resends it instead of leaving the bubble `sending`
    // for good. Hosts without an outbox keep the old behaviour.
    if (ctx.outbox !== undefined) {
      outboxFailed(
        ctx,
        chatId,
        localId,
        trimmed,
        wireReply?.id,
        wireReply?.text,
        mentions,
        undefined,
        ctx.ports.now().getTime(),
      );
    }
    return;
  }
  // The core passes `{}` for a plain text (web's pinned shape); mobile sets
  // `omitEmptyTextOptions` so its plain texts stay `undefined`.
  const sendOptions =
    replyTo === undefined && mentions.length === 0 && ctx.omitEmptyTextOptions === true
      ? undefined
      : {
          ...(wireReply === undefined
            ? {}
            : {
                replyTo: {
                  id: wireReply.id,
                  ...(wireReply.text === undefined ? {} : { text: wireReply.text }),
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
  return void ctx.rt.fork(
    fromPromise(() => current.sendMessage(chatId, coreKind(chat), trimmed, sendOptions)).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, chat, localId, sent.id);
          // The stanza reached the server, but the honest `sent` tick waits
          // for the stream-management ack (or the echo, whichever lands
          // first; both move the bubble forward only). Hosts without an
          // outbox keep the old tick.
          if (ctx.outbox === undefined) {
            ctx.k.updateMessageStatus(chatId, localId, 'sent');
          } else {
            outboxFailed(
              ctx,
              chatId,
              localId,
              trimmed,
              wireReply?.id,
              wireReply?.text,
              mentions,
              sent.id,
              ctx.ports.now().getTime(),
            );
          }
        }),
      ),
      // The send failed (`NotOnline` or a socket error): the bubble stays
      // `sending` and the outbox resends it on the next online.
      Effect.catchCause(() =>
        Effect.sync(() => {
          if (ctx.outbox !== undefined) {
            outboxFailed(
              ctx,
              chatId,
              localId,
              trimmed,
              wireReply?.id,
              wireReply?.text,
              mentions,
              undefined,
              ctx.ports.now().getTime(),
            );
          }
        }),
      ),
    ),
  );
}

// Marks the bubble `sent` once stream management confirms its stanza id: the
// server has the stanza, so the tick is honest. Runs from the core's `acked`
// listener (wired in the lifecycle's `subscribeToCore`).
export function ackText(ctx: SendCtx, stanzaId: string): void {
  if (ctx.outbox === undefined) {
    return;
  }
  outboxAcked(ctx, ctx.outbox, stanzaId);
}

// Requeues a bubble stream management lost without an ack (`unacked`): the
// next online resends it once, under the same stanza id. Runs from the
// core's `unacked` listener (wired in the lifecycle's `subscribeToCore`).
// A resume never fires this (its `h` covers the queued stanzas), so a
// stanza the server already has is never resent (T-1216).
export function unackText(ctx: SendCtx, stanzaId: string): void {
  if (ctx.outbox === undefined) {
    return;
  }
  outboxUnacked(ctx, ctx.outbox, stanzaId);
}
