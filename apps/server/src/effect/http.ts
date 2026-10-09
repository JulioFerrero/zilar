// The Hono bridge into the Effect HTTP modules (T-0498, plan §2.1/§4.2):
// mount an Effect `HttpApi` under Hono one route module at a time. Hono stays
// the edge (request id, request log, CORS, origin guard, better-auth); the
// module behind it is an Effect handler turned into a fetch handler by
// `HttpRouter.toWebHandler`.
//
// Only the bridge that Hono calls lives here. The Hono-free helpers every
// module shares — `CurrentUser`, `Session`, `sessionLayer`, `requestIdOf`,
// `socketAddressOf`, `httpErrorResponse`, `failureResponse`,
// `withErrorEnvelope` and the route types — live in `./http-core`.

import { getConnInfo } from '@hono/node-server/conninfo';
import type { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import {
  REQUEST_ID_HEADER,
  SOCKET_ADDRESS_HEADER,
  type EffectApiRoute,
  type EffectApiWebHandler,
} from './http-core';

export { SOCKET_ADDRESS_HEADER } from './http-core';

type ServerApp = Hono<{ Variables: RequestIdVariables }>;

function forwardRequest(context: HonoContext<{ Variables: RequestIdVariables }>): Request {
  const headers = new Headers(context.req.raw.headers);
  const requestId = context.get('requestId');
  if (requestId) {
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  // Strip any client-forged value first: only the edge may set it.
  headers.delete(SOCKET_ADDRESS_HEADER);
  headers.set(SOCKET_ADDRESS_HEADER, readSocketAddress(context));
  return new Request(context.req.raw, { headers });
}

// The socket address as the server sees it: the same `getConnInfo` read
// with the same `'unknown'` fallback as the Hono route modules use.
function readSocketAddress(context: HonoContext<{ Variables: RequestIdVariables }>): string {
  try {
    const address = getConnInfo(context).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Mounts a fetch handler under a Hono prefix: the exact prefix and everything
 * below it. Prefer {@link mountEffectRoutes} for module routes, so the authz
 * sweep still sees each method and path.
 */
export function mountEffectApi(
  app: ServerApp,
  prefix: string,
  webHandler: EffectApiWebHandler,
): void {
  const handler = (context: HonoContext<{ Variables: RequestIdVariables }>) =>
    webHandler(forwardRequest(context));
  app.all(prefix, handler);
  app.all(`${prefix}/*`, handler);
}

/**
 * Mounts a fetch handler on exact Hono method + path pairs. The routes keep
 * the shape of the previous `app.route(...)` registration, so `app.routes`
 * (and the 401 authorization sweep) sees the same methods and paths.
 */
export function mountEffectRoutes(
  app: ServerApp,
  routes: ReadonlyArray<EffectApiRoute>,
  webHandler: EffectApiWebHandler,
): void {
  for (const route of routes) {
    app.on(route.method, route.path, (context) => webHandler(forwardRequest(context)));
  }
}
