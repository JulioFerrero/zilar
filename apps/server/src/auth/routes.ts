import { Hono } from 'hono';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { Auth } from './auth';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';

export interface AuthRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
}

export function createAuthRoutes({ auth, db, config }: AuthRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/me', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      createdAt: user.createdAt,
    });
  });

  routes.post('/invites', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const invite = await createInvite(db, { createdBy: user.id });
    return c.json({
      code: invite.code,
      url: `${config.PUBLIC_URL}/invite/${invite.code}`,
      expiresAt: invite.expiresAt,
    });
  });

  routes.get('/invites/:code', async (c) => {
    const invite = await findUsableInvite(db, c.req.param('code'));
    return c.json({ valid: invite !== null });
  });

  routes.delete('/invites/:code', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const code = c.req.param('code');

    const invite = await findInviteByCode(db, code);
    if (!invite) {
      throw new HttpError(404, 'not_found', 'Invite not found');
    }
    if (invite.createdBy !== user.id) {
      throw new HttpError(403, 'forbidden', 'Only the creator can revoke this invite');
    }

    await revokeInvite(db, code);
    return c.json({ revoked: true });
  });

  return routes;
}

async function requireSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return session;
}
