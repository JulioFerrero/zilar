import { Hono } from 'hono';
import { z } from 'zod';
import type { ServerConfig } from '../config';
import { refreshRosterNicknames } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { findXmppAccount } from '../xmpp/provisioning';
import type { Auth } from './auth';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';
import { requireSession } from './session';

export interface AuthRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger?: AuthRoutesLogger;
}

// Minimal slice of pino's Logger the route needs, so tests can pass a capture.
export interface AuthRoutesLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// 1-64 characters after trimming, with no control characters.
const displayNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'name must not be empty' })
  .max(64, { message: 'name must be at most 64 characters' })
  .refine((value) => [...value].every((character) => !isControlCharacter(character)), {
    message: 'name must not contain control characters',
  });

const updateMeSchema = z.object({ name: displayNameSchema });

export function createAuthRoutes({
  auth,
  db,
  config,
  adminClient,
  logger,
}: AuthRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/me', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const account = await findXmppAccount(db, user.id);
    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      createdAt: user.createdAt,
      jid: account?.jid ?? null,
    });
  });

  routes.patch('/me', async (c) => {
    await requireSession(auth, c.req.raw.headers);

    const body = await c.req.json().catch(() => null);
    const parsed = updateMeSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid name',
      );
    }

    // Update through Better Auth's own API so its hooks and validation apply.
    await auth.api.updateUser({
      headers: c.req.raw.headers,
      body: { name: parsed.data.name },
    });

    const { user } = await requireSession(auth, c.req.raw.headers);

    // The nickname must follow the name in every contact's roster. This is
    // best-effort: a failure leaves the rows `roster_synced = false` and the
    // token endpoint retries with the current name.
    try {
      const refreshed = await refreshRosterNicknames(
        db,
        adminClient,
        config.xmpp.domain,
        user.id,
        user.name,
      );
      if (!refreshed.ok) {
        logger?.warn(
          { userId: user.id, pending: refreshed.pending },
          'roster nickname refresh is incomplete',
        );
      }
    } catch (error) {
      logger?.warn({ userId: user.id, err: error }, 'could not refresh roster nicknames');
    }

    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
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

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
}
