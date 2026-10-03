// Contact request routes (T-0163): create, list, accept, decline, cancel.
// Every route needs a session. Reads are rate limited; creates carry their
// own 20-per-day limiter plus the in-code caps.

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { ServerConfig } from '../config';
import {
  acceptContactRequest,
  cancelContactRequest,
  createContactRequest,
  declineContactRequest,
  listContactRequests,
  profileForHandle,
  type ContactRequestRow,
} from './service';

export const CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX = 20;
export const CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONTACT_REQUEST_READ_RATE_LIMIT_MAX = 60;
export const CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const BY_HANDLE_RATE_LIMIT_MAX = 30;
export const BY_HANDLE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const createBodySchema = z.object({ handle: z.string().min(1).max(64) }).strict();

export interface ContactRequestsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  audit?: AuditRecorder;
  /** Injected in tests so the rate windows can advance without waiting. */
  now?: () => number;
  createLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
  byHandleLimiter?: RateLimiter;
}

function toJson(row: ContactRequestRow) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}

export function createContactRequestsRoutes(deps: ContactRequestsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const createLimiter =
    deps.createLimiter ??
    createRateLimiter({
      max: CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX,
      windowMs: CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const readLimiter =
    deps.readLimiter ??
    createRateLimiter({
      max: CONTACT_REQUEST_READ_RATE_LIMIT_MAX,
      windowMs: CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const byHandleLimiter =
    deps.byHandleLimiter ??
    createRateLimiter({
      max: BY_HANDLE_RATE_LIMIT_MAX,
      windowMs: BY_HANDLE_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function service() {
    return {
      db: deps.db,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
    };
  }

  // Creates a pending request to the owner of `handle`. Unknown handles
  // answer the same 404 as retired ones; the reverse-request case returns
  // the existing request so the web can offer "Accept".
  routes.post('/contact-requests', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!createLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { request, reverseOf } = await createContactRequest(
      service(),
      user.id,
      parsed.data.handle,
    );
    if (reverseOf) {
      return c.json({ request: toJson(reverseOf), incoming: true }, 409);
    }
    return c.json({ request: toJson(request) }, 201);
  });

  // The viewer's pending requests: `{ incoming, outgoing }`, newest first,
  // with the other person's name, handle and image. Never an email.
  routes.get('/contact-requests', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await listContactRequests(service(), user.id));
  });

  // Accepts a request (recipient only). Idempotent and repairing: every
  // accept re-runs the pair write and the roster sync.
  routes.post('/contact-requests/:id/accept', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const request = await acceptContactRequest(service(), c.req.param('id'), user.id);
    return c.json({ request: toJson(request) });
  });

  // Declines a request (recipient only). Not-actable and unknown ids answer
  // the same 404.
  routes.post('/contact-requests/:id/decline', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const request = await declineContactRequest(service(), c.req.param('id'), user.id);
    return c.json({ request: toJson(request) });
  });

  // Cancels a request (sender only). Not-actable and unknown ids answer the
  // same 404.
  routes.delete('/contact-requests/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const request = await cancelContactRequest(service(), c.req.param('id'), user.id);
    return c.json({ request: toJson(request) });
  });

  // Exact, case-insensitive handle lookup: `{ userId, name, handle, image,
  // relation }`. Unknown and retired handles answer the same 404. There is
  // no prefix or partial search anywhere. Never an email.
  routes.get('/users/by-handle/:handle', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!byHandleLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await profileForHandle(deps.db, user.id, c.req.param('handle')));
  });

  return routes;
}
