import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { syncRoster } from '../contacts/service';
import { createRateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from './admin-client';
import type { XmppConfig } from './config';
import { ensureXmppAccount } from './provisioning';
import { issueXmppToken } from './token';

export const TOKEN_TTL_SECONDS = 300;
export const TOKEN_RATE_LIMIT_MAX = 30;
export const TOKEN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface XmppRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  xmppConfig: XmppConfig;
  logger: XmppLogger;
  now?: () => number;
}

// Minimal slice of pino's Logger the route needs, so tests can pass a capture.
export interface XmppLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export function createXmppRoutes({
  auth,
  db,
  adminClient,
  xmppConfig,
  logger,
  now = Date.now,
}: XmppRoutesDependencies): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter({
    max: TOKEN_RATE_LIMIT_MAX,
    windowMs: TOKEN_RATE_LIMIT_WINDOW_MS,
    now,
  });

  routes.post('/xmpp/token', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);

    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many token requests');
    }

    const { jid, provisioned } = await ensureXmppAccount(
      db,
      adminClient,
      user.id,
      xmppConfig.domain,
      {
        requesterId: user.id,
      },
    );
    if (!provisioned) {
      logger.warn({ userId: user.id }, 'xmpp account could not be provisioned');
      throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
    }

    // Retry any roster items a failed sign-up could not push. A failure here
    // is not fatal: the user can still chat and the next request retries.
    const roster = await syncRoster(db, adminClient, xmppConfig.domain, user.id);
    if (!roster.ok) {
      logger.warn({ userId: user.id, pending: roster.pending }, 'roster sync is incomplete');
    }

    const { token, expiresAt } = await issueXmppToken(xmppConfig, jid, TOKEN_TTL_SECONDS);

    return c.json({
      jid,
      token,
      expiresAt: expiresAt.toISOString(),
      service: xmppConfig.wsPublicUrl,
      domain: xmppConfig.domain,
      mucDomain: xmppConfig.mucDomain,
    });
  });

  return routes;
}
