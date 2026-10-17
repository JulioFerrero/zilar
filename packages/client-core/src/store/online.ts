// The single place every path that ends `online` runs (T-1197): the core's
// `status` listener, the `reconnect()` resume path (which sets `online`
// itself when the core comes back without emitting a fresh event), and the
// boot connect path (via the listener). Split from `lifecycle.ts`, which is
// at its line budget.
import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise } from './ctx';
import { flushPending, type HistoryCtx } from './history';
import { flushOutbox, type SendCtx } from './send';
import { outboxRebound } from './send/outbox';

/** What `wake()` reported, borrowed from the core's own signature: the
 * package root exports `XmppCore` but not the outcome type. */
type WakeOutcome = Awaited<ReturnType<NonNullable<XmppCore['wake']>>>;

/** Runs the pending history open and resends every waiting text. One helper
 * so no path that ends `online` can miss the outbox flush: a text queued
 * while offline (no `stanzaId`) goes out again with the same id, and one
 * whose stanza was lost (`awaitingResend`, set by `unacked` or a `rebound`)
 * does too. A stanza the resumed stream still covers is not resent. */
export function flushOnline(ctx: HistoryCtx): void {
  flushPending(ctx);
  flushOutbox(ctx as unknown as SendCtx, ctx.ports.now().getTime());
}

/** Marks every in-flight text for one resend after a `rebound` (a fresh
 * session, not a resume): its stanza may have died with the old stream. */
export function markReboundOutbox(ctx: HistoryCtx): void {
  outboxRebound(ctx as unknown as SendCtx);
}

/** Wakes the core and, when it reported a `rebound` (a fresh session), marks
 * the outbox for one resend before the caller flushes it. A `resumed` session
 * carried the queued stanzas, so nothing is marked. Returns the outcome so the
 * caller can skip work a resume already kept; a core without `wake` reports
 * `'unknown'`. */
export function wakeAndResend(
  ctx: HistoryCtx,
  current: XmppCore,
): Effect.Effect<WakeOutcome | 'unknown', unknown> {
  const wake = current.wake;
  if (wake === undefined) {
    return fromPromise(() => current.connect()).pipe(Effect.as('unknown'));
  }
  return fromPromise(() => wake()).pipe(
    Effect.tap((outcome) =>
      Effect.sync(() => {
        if (outcome === 'rebound') {
          markReboundOutbox(ctx);
        }
      }),
    ),
  );
}
