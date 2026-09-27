import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
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
  const limiter = createRateLimiter(now);

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

async function requireSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return session;
}

// Simple in-memory limiter keyed by user id. It is per process: with several
// server processes a user could get the limit per process, which is acceptable
// for the short-lived chat token.
function createRateLimiter(now: () => number): { allow: (key: string) => boolean } {
  const attempts = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const cutoff = now() - TOKEN_RATE_LIMIT_WINDOW_MS;
      const recent = (attempts.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= TOKEN_RATE_LIMIT_MAX) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(now());
      attempts.set(key, recent);
      return true;
    },
  };
}
