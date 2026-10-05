// Block routes (T-0171, part 1a): PUT/DELETE `/api/blocks/:userId` and
// GET `/api/blocks`. Every route needs a session. Writes share one
// 30-per-10-minutes limiter keyed by the caller; reads share one
// 120-per-minute limiter, like the contact-request routes.

import { Hono } from 'hono';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { blockUser, listBlockedUsers, unblockUser } from './service';

export const BLOCK_WRITE_RATE_LIMIT_MAX = 30;
export const BLOCK_WRITE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const BLOCK_READ_RATE_LIMIT_MAX = 120;
export const BLOCK_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface BlocksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  writeLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
}

export function createBlocksRoutes(deps: BlocksRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: BLOCK_WRITE_RATE_LIMIT_MAX,
      windowMs: BLOCK_WRITE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const readLimiter =
    deps.readLimiter ??
    createRateLimiter({
      max: BLOCK_READ_RATE_LIMIT_MAX,
      windowMs: BLOCK_READ_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function service(): { db: ServerDatabase; audit?: AuditRecorder } {
    return {
      db: deps.db,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  // Blocks `:userId`, idempotent. Unknown users answer 404, yourself 400.
  routes.put('/blocks/:userId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await blockUser(service(), user.id, c.req.param('userId')));
  });

  // Unblocks `:userId`, idempotent: unblocking someone never blocked still
  // answers success.
  routes.delete('/blocks/:userId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await unblockUser(service(), user.id, c.req.param('userId')));
  });

  // The blocker's list, newest first: `{ blocked: [{ userId, name, handle,
  // image, jid }] }` (`jid` is null when the person has no XMPP account).
  // Never an email.
  routes.get('/blocks', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await listBlockedUsers(service(), user.id));
  });

  return routes;
}
