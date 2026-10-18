import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise } from './ctx';

/** Parks the XMPP session when the app leaves the foreground; a core without
 * `suspend` stays as it is. Best effort and silent: the next resume reconnects. */
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
 * Brings a core back after a suspend: `wake()` when the core supports it, else a plain
 * `connect()`. Never trusts a stale `online` status: `wake()` reconnects either way.
 */
export const wakeCore = (current: XmppCore): Effect.Effect<void, unknown> => {
  const wake = current.wake;
  return wake === undefined
    ? fromPromise(() => current.connect())
    : fromPromise(() => wake()).pipe(Effect.asVoid);
};
