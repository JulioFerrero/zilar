// After `authFailed`: ask the server whether the session still exists before retrying, so
// a revoked session sends the user to login instead of retrying the ladder for ever.
import { Effect } from 'effect';
import { fromPromise } from './ctx';
import type { Fibers, Lifetime } from './lifetime';
import type { CoreMe, CorePorts } from './ports';

export type SessionCheck = 'valid' | 'gone' | 'unknown';

export interface SessionCheckCtx {
  readonly ports: CorePorts;
  readonly rt: Pick<Lifetime<never>, 'session' | 'runDetached'>;
  connectRetryPending: boolean;
}

export type ScheduleConnectRetry<C extends SessionCheckCtx> = (
  ctx: C,
  session: Fibers<never>,
  me: CoreMe,
) => Effect.Effect<void>;

/**
 * An `authFailed` answer: the session may be gone (revoked on the server) or the 401s may
 * be transient. `GET /api/me` answering `'gone'` signs out and stops the ladder; anything
 * else keeps it. One check at a time per store, guarded by `connectRetryPending`.
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
  // The pending flag also covers the in-flight check, so a second `authFailed` while the
  // check runs does not start another one.
  ctx.connectRetryPending = true;
  ctx.rt.runDetached(
    fromPromise(check).pipe(
      Effect.catchCause(() => Effect.succeed('unknown' as SessionCheck)),
      Effect.andThen((result) =>
        Effect.sync(() => {
          // A `stop()` + `start()` (or a sign-in as another user) while the check was in
          // flight must not sign out the new session, clear its flag or schedule the old retry.
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
