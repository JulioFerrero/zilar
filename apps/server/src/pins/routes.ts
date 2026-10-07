import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { registerSqlRuntime } from '../effect/sql';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { createPinBodySchema, listPins, pinMessage, unpinMessage } from './service';

export const PINS_WRITE_RATE_LIMIT_MAX = 60;
export const PINS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface PinsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

const listQuerySchema = z.object({ chat: z.string().min(1).max(255) }).strict();

export function createPinsRoutes(deps: PinsRoutesDependencies): Hono {
  const routes = new Hono();
  // The pins queries run on `effect/sql`; bind its runtime to the database
  // the app is already using. Tests hand us the drizzle-wrapped PGlite, so
  // their database and the pins client are the same instance.
  registerSqlRuntime(deps.db, deps.config.DATABASE_URL);
  const writeLimiter = createRateLimiter({
    max: PINS_WRITE_RATE_LIMIT_MAX,
    windowMs: PINS_WRITE_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  function serviceDeps() {
    return {
      db: deps.db,
      domain: deps.config.xmpp.domain,
      mucDomain: deps.config.xmpp.mucDomain,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  routes.get('/pins', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    return c.json({ pins: await listPins(serviceDeps(), parsed.data.chat, user.id) });
  });

  routes.post('/pins', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many pins, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = createPinBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const pin = await pinMessage(serviceDeps(), { ...parsed.data, actorId: user.id });
    return c.json(pin, 201);
  });

  routes.delete('/pins/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many pins, try again later');
    }
    return c.json(await unpinMessage(serviceDeps(), c.req.param('id'), user.id));
  });

  return routes;
}
