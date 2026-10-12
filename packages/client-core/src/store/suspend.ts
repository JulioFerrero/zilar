// The background-lifecycle helpers of `lifecycle.ts` (F1, T-1151). Split from
// `lifecycle.ts`, which is at its line budget. The context is structural, not
// the full `LifecycleCtx`, so this module stays importable from it.
import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise } from './ctx';

/** Parks the XMPP session when the app leaves the foreground (F1): a core
 * without `suspend` (an old fake) stays as it is. Best effort and silent: a
 * suspension never surfaces as an error, the next resume reconnects. */
export const suspendStore = (ctx: { core: XmppCore | undefined }): Effect.Effect<void, unknown> =>
  Effect.suspend(() => {
    const current = ctx.core;
    const suspend = current?.suspend;
    if (current === undefined || suspend === undefined) {
      return Effect.void;
    }
    return fromPromise(() => suspend()).pipe(
      Effect.asVoid,
      Effect.catchCause(() => Effect.void),
    );
  });

/**
 * Brings a core back after a background suspend (F1): `wake()` when the core
 * supports it (the real core does), else a plain `connect()`. Never trusts a
 * stale `online` status (MP-1): `wake()` reconnects either way.
 */
export const wakeCore = (current: XmppCore): Effect.Effect<void, unknown> => {
  const wake = current.wake;
  return wake === undefined
    ? fromPromise(() => current.connect())
    : fromPromise(() => wake()).pipe(Effect.asVoid);
};
