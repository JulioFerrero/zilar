import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise } from './ctx';
import { flushPending, type HistoryCtx } from './history';
import { type SendCtx } from './send';
import { flushOutbox } from './send/outbox';
import { outboxRebound } from './send/outbox';

/** What `wake()` reported, from the core's own signature: the package root exports
 * `XmppCore` but not the outcome type. */
type WakeOutcome = Awaited<ReturnType<NonNullable<XmppCore['wake']>>>;

/**
 * Runs the pending history open and resends every waiting text, so no path that ends
 * `online` misses the outbox flush: a text queued offline, or whose stanza was lost, goes
 * out again; one a resumed stream still covers is not resent.
 */
export function flushOnline(ctx: HistoryCtx): void {
  flushPending(ctx);
  flushOutbox(ctx as unknown as SendCtx, ctx.ports.now().getTime());
}

/** Marks every in-flight text for one resend after a `rebound`: its stanza may have died
 * with the old stream. */
export function markReboundOutbox(ctx: HistoryCtx): void {
  outboxRebound(ctx as unknown as SendCtx);
}

/**
 * Wakes the core and, on a `rebound` (a fresh session, not a resume), marks the outbox for
 * one resend before the caller flushes. A `resumed` session carried the queued stanzas; a
 * core without `wake` reports `'unknown'`.
 */
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
