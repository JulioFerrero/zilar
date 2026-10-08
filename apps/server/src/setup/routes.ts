// First-run setup routes (T-0161). Whoever opens a new server first
// sets it up: there is no setup token. "Setup needed" means no user
// exists at all (there is no global admin role); once a user exists the
// setup routes answer the same 404 as an unknown route.
//
// The item-11 wrapper (EFFECT_GUIDE): `createSetupRoutes` keeps the old
// Hono factory signature for the route-shape test, but every route is served
// by the Effect `HttpApi` handler in `./api`.
//
// The per-IP limiter runs on the socket address, which the edge only may set.
// This wrapper copies the raw headers, deletes any client-forged socket header
// and stamps the `getConnInfo` socket address before forwarding a new
// `Request` to the Effect handler.

import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import type { HttpServerRequest } from 'effect/http';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { SOCKET_ADDRESS_HEADER } from '../effect/http';
import type { CurrentMailer, Mailer } from '../auth/mailer';
import type { RateLimiter } from '../rate-limit';
import { createSetupApi, SETUP_API_ROUTES } from './api';

export { SETUP_RATE_LIMIT_MAX, SETUP_RATE_LIMIT_WINDOW_MS } from './api';

export interface SetupRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** The live mailer, swapped to the stored Resend transport on success. */
  mailer: CurrentMailer;
  logger: Logger;
  audit?: AuditRecorder;
  /** Overrides the per-IP setup limiter (tests inject a small budget). */
  limiter?: RateLimiter | undefined;
  /** Injected in tests; production trusts proxy hops like the join limiter. */
  getClientIp?: ((request: HttpServerRequest.HttpServerRequest) => string) | undefined;
  /** Injected in tests; production trusts TRUSTED_PROXY_HOPS like the join limiter. */
  trustedProxyHops?: number | undefined;
  /** Sends the test code through the new mailer; tests inject a fake. */
  sendTestCode?:
    | ((input: { auth: Auth; mailer: Mailer; email: string; inviteCode: string }) => Promise<void>)
    | undefined;
  /**
   * Swaps the live mailer after the test send succeeds; tests inject a
   * capture. Defaults to swapping the shared `mailer` above.
   */
  swapMailer?: ((mailer: Mailer) => void) | undefined;
}

export function createSetupRoutes(deps: SetupRoutesDependencies): Hono {
  const api = createSetupApi(deps);
  const routes = new Hono();
  for (const route of SETUP_API_ROUTES) {
    const local = route.path.replace(/^\/api/, '');
    routes.on(route.method, local, (context) => {
      const headers = new Headers(context.req.raw.headers);
      // Strip any client-forged value first: only this wrapper (or the edge's
      // `forwardRequest`) may set it.
      headers.delete(SOCKET_ADDRESS_HEADER);
      headers.set(SOCKET_ADDRESS_HEADER, socketAddress(context));
      return api.handler(new Request(context.req.raw, { headers }));
    });
  }
  return routes;
}

// The socket address as the server sees it. Proxy headers (x-forwarded-for and
// friends) are deliberately not trusted here — anyone can forge them — until
// the deployment task puts the server behind a configured trusted proxy.
// Tests inject getClientIp instead.
function socketAddress(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}
