import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { InviteLogger } from '../groups/service';
import {
  createInviteLink,
  INVITE_LINK_CREATE_MAX_EXPIRY_HOURS,
  INVITE_LINK_CREATE_MAX_USES,
  INVITE_LINK_LABEL_MAX,
  INVITE_LINK_MIN_EXPIRY_HOURS,
  INVITE_LINK_MIN_MAX_USES,
  INVITE_LINK_TOKEN_HEX_LENGTH,
  JOIN_RATE_LIMIT_MAX_PER_IP,
  JOIN_RATE_LIMIT_MAX_PER_USER,
  JOIN_RATE_LIMIT_WINDOW_MS,
  joinByInviteLink,
  listInviteLinks,
  previewInviteLink,
  revokeInviteLink,
} from './service';

export interface InviteLinksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
  audit?: AuditRecorder;
  /** Injected in tests so the join windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests; production uses the socket address. */
  getClientIp?: (c: Context) => string;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter };
}

// Test seam for the join rate windows, set on the app module by
// `setTestAppInviteLinks` (see app.ts). Production never sets it.
export interface TestInviteLinksOverrides {
  now?: () => number;
  getClientIp?: (c: Context) => string;
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const tokenSchema = z.string().regex(TOKEN_PATTERN, { message: 'Invalid invite link' });

const createLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(INVITE_LINK_LABEL_MAX).optional(),
    expiresInHours: z
      .number()
      .int()
      .min(INVITE_LINK_MIN_EXPIRY_HOURS)
      .max(INVITE_LINK_CREATE_MAX_EXPIRY_HOURS)
      .optional(),
    maxUses: z
      .number()
      .int()
      .min(INVITE_LINK_MIN_MAX_USES)
      .max(INVITE_LINK_CREATE_MAX_USES)
      .optional(),
  })
  .strict();

function serviceDeps(deps: InviteLinksRoutesDependencies) {
  return {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.config.xmpp.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

export function createInviteLinksRoutes(deps: InviteLinksRoutesDependencies): Hono {
  const routes = new Hono();
  const webBaseUrl = deps.config.WEB_BASE_URL;
  const userJoinLimiter =
    deps.joinLimiters?.user ??
    createRateLimiter({
      max: JOIN_RATE_LIMIT_MAX_PER_USER,
      windowMs: JOIN_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });
  const ipJoinLimiter =
    deps.joinLimiters?.ip ??
    createRateLimiter({
      max: JOIN_RATE_LIMIT_MAX_PER_IP,
      windowMs: JOIN_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });
  const clientIp = deps.getClientIp ?? socketAddress;

  // Group owner/admin creates a link: the token is shown once here and
  // never stored. Rate limit the join side, not creation (creation needs
  // the group's managers, who are capped at 10 active links anyway).
  routes.post('/groups/:id/invite-links', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = createLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const link = await createInviteLink(serviceDeps(deps), webBaseUrl, {
      groupId: c.req.param('id'),
      actorId: user.id,
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
      ...(parsed.data.expiresInHours === undefined
        ? {}
        : { expiresInHours: parsed.data.expiresInHours }),
      ...(parsed.data.maxUses === undefined ? {} : { maxUses: parsed.data.maxUses }),
    });
    return c.json(link, 201);
  });

  // Group owner/admin lists links: hints, labels, uses and state — the
  // tokens are never returned (they were shown once at creation).
  routes.get('/groups/:id/invite-links', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const links = await listInviteLinks(serviceDeps(deps), c.req.param('id'), user.id);
    return c.json({ links });
  });

  // Group owner/admin revokes a link. Idempotent: revoking twice (or a
  // missing id of this group) still answers 204.
  routes.delete('/groups/:id/invite-links/:linkId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    await revokeInviteLink(serviceDeps(deps), c.req.param('id'), user.id, c.req.param('linkId'));
    return c.body(null, 204);
  });

  // Join preview: group title and member count only, never member names.
  // Unknown/expired/revoked/exhausted links answer the same 404
  // `invalid_link`, so failures never reveal why.
  routes.get('/join/:token', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const token = tokenSchema.safeParse(c.req.param('token'));
    if (!token.success) {
      throw new HttpError(404, 'invalid_link', 'This invite link is invalid or has expired');
    }
    return c.json(await previewInviteLink(serviceDeps(deps), token.data, user.id));
  });

  // Joins the caller as a `member` through the existing add-member flow and
  // consumes one use atomically. Rate limited per user and per IP so tokens
  // cannot be guessed at scale.
  routes.post('/join/:token', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const token = tokenSchema.safeParse(c.req.param('token'));
    if (!token.success) {
      throw new HttpError(404, 'invalid_link', 'This invite link is invalid or has expired');
    }
    if (!userJoinLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
    }
    if (!ipJoinLimiter.allow(clientIp(c))) {
      throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
    }
    const result = await joinByInviteLink(serviceDeps(deps), token.data, user.id);
    return c.json(result);
  });

  return routes;
}

// The socket address as the server sees it. Proxy headers (x-forwarded-for
// and friends) are deliberately not trusted here — anyone can forge them —
// until the deployment task puts the server behind a configured trusted
// proxy. Tests inject getClientIp instead.
function socketAddress(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}

export { INVITE_LINK_TOKEN_HEX_LENGTH };
