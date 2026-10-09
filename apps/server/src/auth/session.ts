import { Effect } from 'effect';
import { HttpError } from '../errors';
import type { Auth } from './auth';

// Every route below requires a signed-in user. Accepts either Better Auth's
// session cookie or its bearer token, because `getSession` understands both.
export const requireSessionEffect = (auth: Auth, headers: Headers) =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(() => auth.api.getSession({ headers }));
    if (!session) {
      return yield* Effect.fail(new HttpError(401, 'unauthorized', 'Authentication required'));
    }
    return session;
  });

export const requireSession = (auth: Auth, headers: Headers) =>
  Effect.runPromise(requireSessionEffect(auth, headers));
