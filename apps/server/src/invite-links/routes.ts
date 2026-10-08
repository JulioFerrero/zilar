import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { HttpServerRequest } from 'effect/http';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { clientIpFrom, trustedClientIp as sharedTrustedClientIp } from '../http/client-ip';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { RateLimiter } from '../rate-limit';
import { INVITE_LINK_TOKEN_HEX_LENGTH } from './service';

export interface InviteLinksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so the join windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests; production uses the socket address. */
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  /** Injected in tests; production reads TRUSTED_PROXY_HOPS from config. */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

// Test seam for the join rate windows, set on the app module by
// `setTestAppInviteLinks` (see app.ts). Production never sets it.
export interface TestInviteLinksOverrides {
  now?: () => number;
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  /** Overrides TRUSTED_PROXY_HOPS in tests (the test config has no env seam). */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

// The client IP for the per-IP join limiter. With 0 trusted proxy hops
// (the default) the socket address is used and proxy headers are ignored —
// anyone can forge them. With N > 0 (behind N proxies, e.g. Caddy) the
// client IP is the Nth address from the RIGHT of `x-forwarded-for`: the
// proxies append truthfully on the right while an attacker controls only
// the left side. The Effect invite-links handlers read the socket address
// through `socketAddressOf`; this Hono-typed helper stays for the setup
// limiter, which still runs on Hono.
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
// hops are trusted (or the header is missing).
function socketAddress(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}

export { INVITE_LINK_TOKEN_HEX_LENGTH };
