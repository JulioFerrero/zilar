// Public directory routes (T-0164): Explore search over public groups and
// channels, plus the exact `@handle` lookup. Every route needs a session;
// reads are rate limited (30 per 10 minutes per user, like the T-0163
// handle checks).

import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { publicGroupForHandle, searchDirectory, type GroupKind } from './service';

export const DIRECTORY_RATE_LIMIT_MAX = 30;
export const DIRECTORY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const directoryQuerySchema = z.object({
  q: z.string().max(100).optional(),
  kind: z.enum(['group', 'channel']).optional(),
  cursor: z.string().max(200).optional(),
});

export interface DirectoryRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  limiter?: RateLimiter;
}

function toEntry(row: {
  id: string;
  kind: GroupKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    handle: row.handle,
    description: row.description,
    memberCount: row.memberCount,
    joined: row.joined,
    ...(row.avatarUrl === undefined ? {} : { avatarUrl: row.avatarUrl }),
  };
}

export function createDirectoryRoutes(deps: DirectoryRoutesDependencies): Hono {
  const routes = new Hono();
  const limiter =
    deps.limiter ??
    createRateLimiter({
      max: DIRECTORY_RATE_LIMIT_MAX,
      windowMs: DIRECTORY_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });

  // Searches public groups and channels only, by handle or title prefix
  // (case-insensitive). `q` is at least 2 characters when present (empty
  // lists the newest); optional `kind` filter; 20 per page with a cursor.
  // Each row: `{ id, kind, title, handle, description, memberCount,
  // joined }`. Never users, never private groups.
  routes.get('/directory', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const parsed = directoryQuerySchema.safeParse({
      ...(c.req.query('q') === undefined ? {} : { q: c.req.query('q') }),
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('cursor') === undefined ? {} : { cursor: c.req.query('cursor') }),
    });
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const page = await searchDirectory(deps.db, user.id, {
      ...(parsed.data.q === undefined ? {} : { query: parsed.data.q }),
      ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    });
    return c.json({ entries: page.entries.map(toEntry), next: page.next });
  });

  // Exact match of one public group by `@handle`, same row shape as the
  // directory. A private group and an unknown handle answer the same 404.
  routes.get('/groups/by-handle/:handle', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(toEntry(await publicGroupForHandle(deps.db, user.id, c.req.param('handle'))));
  });

  return routes;
}
