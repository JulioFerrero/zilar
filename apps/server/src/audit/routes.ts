import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { listAuditForAi, listAuditForGroup, MAX_AUDIT_LIST_LIMIT } from './service';

export interface AuditRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
}

// One of `groupId` / `aiId` is required, never both. `limit` is clamped in the
// service to the documented range; we still parse it here so a non-integer or
// a negative value answers 400 instead of being silently fixed.
const querySchema = z
  .object({
    groupId: z.string().min(1).max(128).optional(),
    aiId: z.string().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_AUDIT_LIST_LIMIT).optional(),
    before: z.string().min(1).max(256).optional(),
  })
  .strict();

export function createAuditRoutes({ auth, db }: AuditRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/audit', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid audit query');
    }
    const { groupId, aiId, limit, before } = parsed.data;
    const hasGroup = groupId !== undefined;
    const hasAi = aiId !== undefined;
    if (hasGroup === hasAi) {
      throw new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId');
    }

    const options = {
      ...(limit === undefined ? {} : { limit }),
      ...(before === undefined ? {} : { before }),
    };

    try {
      if (hasGroup && groupId !== undefined) {
        const page = await listAuditForGroup(db, groupId, user.id, options);
        return c.json({ entries: page.entries, next: page.next });
      }
      if (hasAi && aiId !== undefined) {
        const page = await listAuditForAi(db, aiId, user.id, options);
        return c.json({ entries: page.entries, next: page.next });
      }
      throw new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId');
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid cursor') {
        throw new HttpError(400, 'invalid_request', 'Invalid cursor');
      }
      throw error;
    }
  });

  return routes;
}
