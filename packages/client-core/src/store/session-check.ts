// After `authFailed`: ask the server whether the session still exists before
// retrying. A revoked session (signed out elsewhere, or deleted) must send
// the user to login instead of retrying the ladder for ever (T-1223).
import { Effect } from 'effect';
import { fromPromise } from './ctx';
import type { Fibers, Lifetime } from './lifetime';
import type { CoreMe, CorePorts } from './ports';

/** What `checkSession` answers about the server session. */
export type SessionCheck = 'valid' | 'gone' | 'unknown';

/** The slice of the lifecycle context `onAuthFailed` reads and writes. */
export interface SessionCheckCtx {
  readonly ports: CorePorts;
  readonly rt: Pick<Lifetime<never>, 'session' | 'runDetached'>;
  connectRetryPending: boolean;
}

/** The connect retry ladder of `lifecycle.ts`, which runs on the same ctx. */
export type ScheduleConnectRetry<C extends SessionCheckCtx> = (
  ctx: C,
  session: Fibers<never>,
  me: CoreMe,
) => Effect.Effect<void>;

/**
 * An `authFailed` answer: the session may be gone (revoked on the server) or
 * the 401s may be transient. `checkSession` asks `GET /api/me`: `'gone'`
 * signs out through `sessionGone` and stops the ladder; anything else —
 * `'valid'`, `'unknown'`, a rejection, or no port at all — keeps the retry
 * ladder, as today. One check at a time per store, guarded by the existing
 * `connectRetryPending` flag.
 */
export const onAuthFailed = <C extends SessionCheckCtx>(
  ctx: C,
  session: Fibers<never>,
  me: CoreMe,
  scheduleConnectRetry: ScheduleConnectRetry<C>,
): void => {
  if (ctx.rt.session() !== session || ctx.connectRetryPending) {
    return;
  }
  const check = ctx.ports.checkSession;
  if (check === undefined) {
    ctx.rt.runDetached(scheduleConnectRetry(ctx, session, me));
    return;
  }
  // The pending flag also covers the in-flight check, so a second
  // `authFailed` while the check runs does not start another one.
  ctx.connectRetryPending = true;
  ctx.rt.runDetached(
    fromPromise(check).pipe(
      Effect.catchCause(() => Effect.succeed('unknown' as SessionCheck)),
      Effect.andThen((result) =>
        Effect.sync(() => {
          // A `stop()` + `start()` (or a sign-in as another user) while the
          // check was in flight leaves a stale completion: it must not sign
          // out the new session, clear its flag, or schedule the old retry.
          if (ctx.rt.session() !== session) {
            return;
          }
          if (result === 'gone') {
            ctx.connectRetryPending = false;
            ctx.ports.sessionGone?.();
            return;
          }
          ctx.connectRetryPending = false;
          ctx.rt.runDetached(scheduleConnectRetry(ctx, session, me));
        }),
      ),
    ),
  );
};
