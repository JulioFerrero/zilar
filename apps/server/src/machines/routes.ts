// The item-11 wrapper (EFFECT_GUIDE): `createMachinesRoutes` keeps the old
// Hono factory signature for the tests that mount it directly, but every
// route is served by the Effect `HttpApi` handler in `./api`.
//
// The per-IP limiter runs on the socket address, which the edge only may set.
// This wrapper copies the raw headers, deletes any client-forged socket header
// and stamps `getClientIp(c)` (tests) or the real socket address (production)
// before forwarding a new `Request` to the Effect handler.

import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { SOCKET_ADDRESS_HEADER } from '../effect/http';
import type { DbMachineRegistry } from './registry';
import { createMachinesApi, MACHINES_API_ROUTES } from './api';

export {
  PAIRING_CODE_RATE_LIMIT_MAX,
  PAIRING_CODE_RATE_LIMIT_WINDOW_MS,
  PAIR_GLOBAL_RATE_LIMIT_MAX,
  PAIR_IP_RATE_LIMIT_MAX,
  PAIR_RATE_LIMIT_WINDOW_MS,
} from './api';

export interface MachinesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: MachinesLogger;
  /** Audit recorder; production wires the server's own recorder. */
  audit?: AuditRecorder;
  /** Shared with the tunnel hub so revokes close live connections. */
  registry?: DbMachineRegistry;
  /** Injected in tests so rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests; production uses the socket address. */
  getClientIp?: (c: Context) => string;
  /** Injected by app.ts when the runner hub is on; absent = hub off. */
  isMachineOnline?: (machineId: string) => boolean;
}

// The pino surface: the Effect envelope logs an unhandled failure through the
// same `error` method the old `onError` used.
export type MachinesLogger = Logger;

export function createMachinesRoutes(deps: MachinesRoutesDependencies): Hono {
  const api = createMachinesApi(deps);
  const routes = new Hono();
  const clientIp = deps.getClientIp ?? socketAddress;
  for (const route of MACHINES_API_ROUTES) {
    const local = route.path.replace(/^\/api/, '');
    routes.on(route.method, local, (context) => {
      const headers = new Headers(context.req.raw.headers);
      // Strip any client-forged value first: only this wrapper (or the edge's
      // `forwardRequest`) may set it.
      headers.delete(SOCKET_ADDRESS_HEADER);
      headers.set(SOCKET_ADDRESS_HEADER, clientIp(context));
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
