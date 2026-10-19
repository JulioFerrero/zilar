// After `authFailed`: ask the server whether the session still exists before retrying, so
// a revoked session sends the user to login instead of retrying the ladder for ever.
import { Effect } from 'effect';
import { ApiError } from '@zilar/api-contract';
import { fromPromise } from './ctx';
import type { Fibers, Lifetime } from './lifetime';
import type { CoreMe, CorePorts } from './ports';

export type SessionCheck = 'valid' | 'gone' | 'unknown';

export interface SessionCheckOptions {
  readonly getMe: () => Promise<unknown>;
  readonly getToken?: () => Promise<string | undefined>;
}

const checkMe = (getMe: () => Promise<unknown>): Effect.Effect<SessionCheck> =>
  Effect.matchEffect(
    Effect.tryPromise({
      try: () => getMe(),
      catch: (error) => error,
    }),
    {
      onFailure: (error: unknown) =>
        Effect.succeed<SessionCheck>(
          error instanceof ApiError && error.status === 401 ? 'gone' : 'unknown',
        ),
      onSuccess: () => Effect.succeed<SessionCheck>('valid'),
    },
  );

/**
 * Builds the session check the reconnect ladder runs. Without `getToken` it is the web
 * rule; with it, a token read that fails is `unknown`, a missing token is `gone`, and the
 * rest follows the web rule. The returned function never rejects.
 */
export const createSessionCheck =
  ({ getMe, getToken }: SessionCheckOptions): (() => Promise<SessionCheck>) =>
  () =>
    Effect.runPromise(
      (getToken === undefined
        ? Effect.succeed<string | undefined>(undefined)
        : Effect.tryPromise({
            try: () => getToken(),
            catch: (error) => error,
          })
      ).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed<SessionCheck>('unknown'),
          onSuccess: (token) =>
            getToken !== undefined && token === undefined
              ? Effect.succeed<SessionCheck>('gone')
              : checkMe(getMe),
        }),
      ),
    );

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
