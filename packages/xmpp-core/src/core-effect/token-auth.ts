import type { XmppCredentialsProvider } from '@xmpp/client';
import { Duration, Effect } from 'effect';
import { jidLocalPart } from '../jid';
import { TOKEN_RETRY_DELAY_MS, isFatalTokenError, type CoreRuntime } from './config';

export type TokenAuthApi = {
  credentials: XmppCredentialsProvider;
};

// The token step of a connect: fetch a fresh token, then hand it to SASL. It
// lives apart from `lifecycle.ts` (which is at its line budget) and adds the
// one retry a fatal-looking token error gets.
export function createTokenAuth(runtime: CoreRuntime): TokenAuthApi {
  // One call into `getToken`, keeping the thrown value as-is: the client's
  // error handler compares it with `transientTokenError` by identity.
  const fetchToken = (): Effect.Effect<{ jid: string; token: string }, unknown> =>
    Effect.tryPromise({
      try: () => runtime.options.getToken(),
      catch: (error) => error,
    });

  // A non-fatal error behaves as before (transient: the client keeps
  // reconnecting). A fatal-looking error (401/403) may still be transient — a
  // session refresh racing a deploy, a stale session cache — so it asks once
  // more after a short wait; only a second fatal error marks `authFailed`.
  const authenticateWithFreshToken = Effect.fnUntraced(function* (
    authenticate: Parameters<XmppCredentialsProvider>[0],
    mechanisms: string[],
  ): Effect.fn.Return<void, unknown> {
    const fresh = yield* fetchToken().pipe(
      Effect.catch((error) => {
        if (!isFatalTokenError(error)) {
          runtime.transientTokenError = error;
          return Effect.fail(error);
        }
        const delay = runtime.options.tokenRetryDelayMs ?? TOKEN_RETRY_DELAY_MS;
        return Effect.sleep(Duration.millis(delay)).pipe(
          Effect.andThen(fetchToken()),
          Effect.catch((retryError) => {
            if (isFatalTokenError(retryError)) {
              runtime.authFailed = true;
            } else {
              runtime.transientTokenError = retryError;
            }
            return Effect.fail(retryError);
          }),
        );
      }),
    );

    runtime.latestToken = fresh.token;
    const mechanism = mechanisms.includes('PLAIN') ? 'PLAIN' : mechanisms[0];
    yield* Effect.tryPromise({
      try: () =>
        authenticate({ username: jidLocalPart(fresh.jid), password: fresh.token }, mechanism),
      catch: (error) => error,
    });
  });

  const credentials: XmppCredentialsProvider = (authenticate, mechanisms) =>
    Effect.runPromise(authenticateWithFreshToken(authenticate, mechanisms));

  return { credentials };
}
