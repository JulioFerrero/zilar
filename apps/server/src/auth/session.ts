import { HttpError } from '../errors';
import type { Auth } from './auth';

// Every route below requires a signed-in user. Accepts either Better Auth's
// session cookie or its bearer token, because `getSession` understands both.
export async function requireSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return session;
}
