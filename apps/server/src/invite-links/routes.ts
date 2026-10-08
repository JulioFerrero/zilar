import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { clientIpFrom, trustedClientIp as sharedTrustedClientIp } from '../http/client-ip';
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
  JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
  JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
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
  /** Injected in tests; production reads TRUSTED_PROXY_HOPS from config. */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

// Test seam for the join rate windows, set on the app module by
// `setTestAppInviteLinks` (see app.ts). Production never sets it.
export interface TestInviteLinksOverrides {
  now?: () => number;
  getClientIp?: (c: Context) => string;
  /** Overrides TRUSTED_PROXY_HOPS in tests (the test config has no env seam). */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
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
  const clientIp =
    deps.getClientIp ?? clientIpFor(deps.trustedProxyHops ?? deps.config.TRUSTED_PROXY_HOPS);
  // The preview is a cheap read, but an unrated GET would let tokens be
  // probed at full speed: a generous per-user budget keeps that expensive.
  const previewLimiter =
    deps.joinLimiters?.preview ??
    createRateLimiter({
      max: JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
      windowMs: JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });

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
  // `invalid_link`, so failures never reveal why. Rate limited per user so
  // tokens cannot be probed at full speed.
  routes.get('/join/:token', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!previewLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
    }
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

// The client IP for the per-IP join limiter. With 0 trusted proxy hops
// (the default) the socket address is used and proxy headers are ignored —
// anyone can forge them. With N > 0 (behind N proxies, e.g. Caddy) the
// client IP is the Nth address from the RIGHT of `x-forwarded-for`: the
// proxies append truthfully on the right while an attacker controls only
// the left side. Only the join limiter uses this; everything else keeps
// the socket address. Tests inject getClientIp instead.
export function clientIpFor(trustedProxyHops: number): (c: Context) => string {
  return (c: Context) =>
    clientIpFrom(
      { forwardedFor: c.req.header('x-forwarded-for'), socketAddress: socketAddress(c) },
      trustedProxyHops,
    );
}

// The Nth address from the right of an `x-forwarded-for` header, or null
// when the header is missing or has fewer than N addresses. Empty entries
// never count as an address. Exported for tests; the rule lives in
// `../http/client-ip`.
export function trustedClientIp(header: string | undefined, hops: number): string | null {
  return sharedTrustedClientIp(header, hops);
}

// The socket address as the server sees it: the fallback when no proxy
// hops are trusted (or the header is missing), and what everything beside
// the join limiter uses.
function socketAddress(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}

export { INVITE_LINK_TOKEN_HEX_LENGTH };
