import { Effect } from 'effect';
import type { ChatSummary, UiMention } from '@zilar/chat-core';
import type { SendMessageOptions } from '@zilar/xmpp-core';
import { type SendCtx, linkSent } from './context';
import { fromPromise } from '../ctx';
import { coreKind } from '../rows';

// The text outbox (F4, honest ticks): texts whose stanza send failed
// (`NotOnline` or any send error) or that stream management reported lost
// (`unacked`) wait here in memory, keyed by the message's local id. The next
// transition into `online` resends each one with the same message id (the
// ledger already linked local and server ids, and the echo path dedupes on
// them). After 3 failed attempts, or 10 minutes without an ack, the bubble
// becomes `failed` with the existing failed shape, so Retry and Delete work
// like any other failed send.

/** Attempts before a waiting text is marked `failed`. */
export const OUTBOX_MAX_ATTEMPTS = 3;

/** How long a text may wait for its ack before it is marked `failed`. */
export const OUTBOX_MAX_WAIT_MS = 10 * 60_000;

export type OutboxEntry = {
  /** The chat the text belongs to. */
  chatId: string;
  /** The optimistic local id (the bubble's id, and the alias root). */
  localId: string;
  /** The stanza/server id the last attempt sent under. */
  stanzaId: string | undefined;
  /** Failed attempts so far. */
  attempts: number;
  /** Set when stream management loses the stanza (`unacked`, a new session):
   * the stanza may never have reached the server, so the next online
   * resends it. Unset on a plain offline queue (no `stanzaId`) or after
   * the resend: a resume never resends. */
  awaitingResend: boolean;
  /** When the text first entered the outbox (for the 10-minute cap). */
  firstQueuedAt: number;
  /** The text and mentions of the original `sendText` call. */
  text: string;
  mentions: readonly UiMention[];
  /** The `<reply/>` target id of the original `sendText` call, if any. */
  replyToId: string | undefined;
  /** The quote `text` of the original reply, for the XEP-0461 fallback. */
  replyToText: string | undefined;
  /** Rebuilds the send options of the original `sendText` call. */
  sendOptions: () => SendMessageOptions | undefined;
};

/** The outbox the send context carries: memory only, cleared on `reset()`. */
export type TextOutbox = Map<string, OutboxEntry>;

export function createTextOutbox(): TextOutbox {
  return new Map();
}

const outboxId = (localId: string): string => localId;

// Records a text whose send failed, or re-records one stream management lost.
// A text the outbox already holds keeps its attempt count and first-queued
// time: each failed send is one attempt, and `acked` drops the entry. A new
// entry arms its wait cap on the store's runtime fork, so the bubble becomes
// `failed` even when no flush ever runs.
export function outboxFailed(
  ctx: SendCtx,
  chatId: string,
  localId: string,
  text: string,
  replyToId: string | undefined,
  replyToText: string | undefined,
  mentions: readonly UiMention[],
  stanzaId: string | undefined,
  now: number,
): void {
  const outbox = ctx.outbox;
  if (outbox === undefined) {
    return;
  }
  const key = outboxId(localId);
  const previous = outbox.get(key);
  if (previous !== undefined) {
    previous.stanzaId = stanzaId ?? previous.stanzaId;
    return;
  }
  outbox.set(key, {
    chatId,
    localId,
    text,
    mentions,
    replyToId,
    replyToText,
    stanzaId,
    attempts: 0,
    awaitingResend: false,
    firstQueuedAt: now,
    sendOptions: () =>
      replyToId === undefined && mentions.length === 0
        ? undefined
        : {
            ...(replyToId === undefined
              ? {}
              : {
                  replyTo: {
                    id: replyToId,
                    ...(replyToText === undefined ? {} : { text: replyToText }),
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
          },
  });
  armOutboxWaitCap(ctx, chatId, localId);
}

// Drops a text the server confirmed: an `acked` for its stanza id settles the
// bubble, whatever attempt sent it.
export function outboxAcked(ctx: SendCtx, outbox: TextOutbox, stanzaId: string): void {
  for (const [key, entry] of outbox) {
    if (entry.stanzaId !== stanzaId && !ctx.k.sameMessage(entry.localId, stanzaId)) {
      continue;
    }
    outbox.delete(key);
    ctx.rt.cancel(outboxTimerKey(entry.localId));
    ctx.k.updateMessageStatus(entry.chatId, entry.localId, 'sent');
  }
}

// A lost stanza (`unacked`) resets the bubble to `sending` for the rebound
// resend below, which retries it under the same stanza id; the caps still
// bound the wait. A resume never calls this: its `h` covers the stanza,
// and the library emits `ack` for it instead (T-1216).
export function outboxUnacked(ctx: SendCtx, outbox: TextOutbox, stanzaId: string): void {
  for (const entry of outbox.values()) {
    if (entry.stanzaId !== stanzaId && !ctx.k.sameMessage(entry.localId, stanzaId)) {
      continue;
    }
    // A bubble an ack or the echo already settled must not go back to
    // `sending` and be resent: the stanza reached the server, so re-sending
    // it would archive a second row under the same id (T-1216).
    const message = ctx.k
      .listFor(ctx.get(), entry.chatId)
      .find((item) => ctx.k.sameMessage(item.id, entry.localId));
    if (message?.status !== 'sending') {
      continue;
    }
    entry.awaitingResend = true;
    ctx.k.updateMessageStatus(entry.chatId, entry.localId, 'sending');
  }
}

// A fresh session replaced the stream without resuming it (`rebound`): every
// stanza the outbox sent on the old stream may be lost, so the next online
// flush resends each one once under the same id (the receiver dedupes on
// `<origin-id/>`). A bubble an ack or the echo already settled is left alone.
// A resume never calls this: its `h` covers the queued stanzas.
export function outboxRebound(ctx: SendCtx): void {
  const outbox = ctx.outbox;
  if (outbox === undefined) {
    return;
  }
  for (const entry of outbox.values()) {
    if (entry.stanzaId === undefined) {
      continue;
    }
    const message = ctx.k
      .listFor(ctx.get(), entry.chatId)
      .find((item) => ctx.k.sameMessage(item.id, entry.localId));
    if (message?.status !== 'sending') {
      continue;
    }
    entry.awaitingResend = true;
  }
}

// Arms the wait cap of a text the outbox just queued: once
// `OUTBOX_MAX_WAIT_MS` has passed with no flush failing it first, the bubble
// becomes `failed` (the same shape and Retry path as any other failed send),
// even when no flush ever runs. Keyed by the entry's local id on the store's
// runtime fork, so a newer entry with the same key replaces an older timer;
// `acked` (which drops the entry) cancels it.
const outboxTimerKey = (localId: string): string => `outbox:${localId}`;

function armOutboxWaitCap(ctx: SendCtx, chatId: string, localId: string): void {
  const outbox = ctx.outbox;
  if (outbox === undefined) {
    return;
  }
  ctx.rt.forkKeyed(
    outboxTimerKey(localId),
    Effect.sleep(OUTBOX_MAX_WAIT_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          const live = outbox.get(outboxId(localId));
          if (live === undefined) {
            return;
          }
          const chat = ctx.get().chats.find((item) => item.id === chatId);
          if (chat === undefined) {
            return;
          }
          const message = ctx.k
            .listFor(ctx.get(), live.chatId)
            .find((item) => ctx.k.sameMessage(item.id, live.localId));
          // Only a bubble still `sending` moves: one that an `acked` settled
          // drops its entry (and its timer), and `failed` stays failed.
          if (message?.status !== 'sending') {
            return;
          }
          failOutboxEntry(ctx, outbox, chat, live);
        }),
      ),
    ),
  );
}

// Snoozes a bubble past its caps: `failed` with the same shape (and the same
// Retry path) as a failed voice or attachment send.
function failOutboxEntry(
  ctx: SendCtx,
  outbox: TextOutbox,
  chat: ChatSummary,
  entry: OutboxEntry,
): void {
  outbox.delete(outboxId(entry.localId));
  ctx.rt.cancel(outboxTimerKey(entry.localId));
  ctx.k.markSendFailed(chat.id, entry.localId, 'network');
}

// One resend of a waiting text: the same stanza id the first send used, so
// the echo path dedupes it and the receiver sees it once (`<origin-id/>`
// matches, and the stanza `id` it carries is identical). A failure records
// one more attempt (the caps decide); the ack or the echo settles the bubble.
function resendOutboxEntry(
  ctx: SendCtx,
  outbox: TextOutbox,
  chat: ChatSummary,
  entry: OutboxEntry,
): void {
  const current = ctx.core;
  if (current === undefined) {
    return;
  }
  const message = ctx.k
    .listFor(ctx.get(), entry.chatId)
    .find((item) => ctx.k.sameMessage(item.id, entry.localId));
  if (message === undefined || message.status !== 'sending' || message.text === undefined) {
    outbox.delete(outboxId(entry.localId));
    return;
  }
  // A resend of a plain text passes no options at all on mobile (`{}` on
  // web); with a `stanzaId` the resend carries the first send's id, so the
  // receiver dedupes on it.
  const sendOptions: SendMessageOptions | undefined =
    entry.replyToId === undefined &&
    entry.mentions.length === 0 &&
    ctx.omitEmptyTextOptions === true &&
    entry.stanzaId === undefined
      ? undefined
      : { ...entry.sendOptions(), ...(entry.stanzaId === undefined ? {} : { id: entry.stanzaId }) };
  entry.awaitingResend = false;
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(entry.chatId, coreKind(chat), entry.text, sendOptions),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          const live = outbox.get(outboxId(entry.localId));
          if (live === undefined) {
            return;
          }
          live.stanzaId = sent.id;
          linkSent(ctx, chat, entry.localId, sent.id);
        }),
      ),
      Effect.catchCause(() =>
        Effect.sync(() => {
          const live = outbox.get(outboxId(entry.localId));
          if (live === undefined) {
            return;
          }
          live.attempts += 1;
          if (live.attempts >= OUTBOX_MAX_ATTEMPTS) {
            failOutboxEntry(ctx, outbox, chat, live);
            return;
          }
          ctx.k.updateMessageStatus(entry.chatId, entry.localId, 'sending');
        }),
      ),
    ),
  );
}

/**
 * Resends waiting texts on the transition into `online`. An entry goes out
 * again only when its stanza never reached a live stream: one the send
 * never attempted (`stanzaId` unset, offline queue) or one a new session
 * replaced (`awaitingResend`, set by `outboxUnacked`). An entry whose
 * stanza went out on the resumed session is never resent: the server's `h`
 * covered it, and a resend under the same id still archives a second row
 * (T-1216). Entries past their caps become `failed` instead; a missing
 * chat or core keeps the entry for the next flush. Called from the
 * lifecycle's online listener.
 */
export function flushOutbox(ctx: SendCtx, now: number): void {
  const outbox = ctx.outbox;
  if (outbox === undefined) {
    return;
  }
  for (const entry of outbox.values()) {
    const chat = ctx.get().chats.find((item) => item.id === entry.chatId);
    if (chat === undefined || ctx.core === undefined) {
      continue;
    }
    if (entry.attempts >= OUTBOX_MAX_ATTEMPTS || now - entry.firstQueuedAt >= OUTBOX_MAX_WAIT_MS) {
      failOutboxEntry(ctx, outbox, chat, entry);
      continue;
    }
    const message = ctx.k
      .listFor(ctx.get(), entry.chatId)
      .find((item) => ctx.k.sameMessage(item.id, entry.localId));
    if (message === undefined || message.status === 'failed') {
      outbox.delete(outboxId(entry.localId));
      continue;
    }
    // No resend without a reason: the entry's stanza went out on the live
    // stream and its ack (or echo) is still on the way.
    if (entry.stanzaId !== undefined && entry.awaitingResend !== true) {
      continue;
    }
    resendOutboxEntry(ctx, outbox, chat, entry);
  }
}
