// Handle routes (T-0163): availability check and claiming `@username`s.
// Every route needs a session and is rate limited.

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  checkHandleAvailability,
  claimHandle,
  isHandleChangeTooSoon,
  reapExpiredRetiredHandles,
} from './store';

export const HANDLE_CHECK_RATE_LIMIT_MAX = 30;
export const HANDLE_CHECK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const HANDLE_CLAIM_RATE_LIMIT_MAX = 10;
export const HANDLE_CLAIM_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const checkQuerySchema = z.object({ handle: z.string().min(1).max(64) });

const claimBodySchema = z.object({ handle: z.string().min(1).max(64) }).strict();

export interface HandlesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so the rate windows can advance without waiting. */
  now?: () => number;
  checkLimiter?: RateLimiter;
  claimLimiter?: RateLimiter;
}

export function createHandlesRoutes(deps: HandlesRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const checkLimiter =
    deps.checkLimiter ??
    createRateLimiter({
      max: HANDLE_CHECK_RATE_LIMIT_MAX,
      windowMs: HANDLE_CHECK_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const claimLimiter =
    deps.claimLimiter ??
    createRateLimiter({
      max: HANDLE_CLAIM_RATE_LIMIT_MAX,
      windowMs: HANDLE_CLAIM_RATE_LIMIT_WINDOW_MS,
      now,
    });

  // Live availability for the typed handle: `{ available, reason? }` with
  // the exact reason (`invalid` | `reserved` | `taken`). A handle held by
  // the asker's own retired reservation counts as available.
  routes.get('/handles/check', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!checkLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const parsed = checkQuerySchema.safeParse({ handle: c.req.query('handle') ?? '' });
    if (!parsed.success) {
      return c.json({ available: false, reason: 'invalid' });
    }
    return c.json(await checkHandleAvailability(deps.db, user.id, parsed.data.handle));
  });

  // Claims (or changes) the caller's handle in one transaction: the change
  // interval is checked (409 `handle_change_too_soon` with `nextChangeAt`;
  // the first claim is always allowed), the old handle retires for 30 days,
  // the new row is written. A unique violation maps to 409 `handle_taken`.
  routes.put('/me/handle', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!claimLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = claimBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    try {
      const claimed = await claimHandle(deps.db, user.id, parsed.data.handle);
      await reapExpiredRetiredHandles(deps.db);
      void deps.audit?.record({
        actorUserId: user.id,
        aiId: null,
        groupId: null,
        action: 'handle.claimed',
        subjectId: user.id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      });
      return c.json(claimed);
    } catch (error) {
      if (isHandleChangeTooSoon(error)) {
        throw new HttpError(409, error.code, error.message);
      }
      throw error;
    }
  });

  return routes;
}
