// The connections Hono router moved onto the Effect `HttpApi` adapter
// (T-0557): `createConnectionsApi` in `./api` serves every route. This module
// keeps the rate-limit constants, the dependency and logger types, and
// `createConnectionsRoutes(deps): Hono` as a thin wrapper for the connections
// route tests (which build a Hono app around it with injected `now`, and mount
// them directly in the rate-limit window test).
export {
  CONNECTION_TEST_RATE_LIMIT_MAX,
  CONNECTION_TEST_RATE_LIMIT_WINDOW_MS,
  CONNECTIONS_API_ROUTES,
  createConnectionsApi,
  type ConnectionsApiDependencies,
  type ConnectionsLogger,
  type ConnectionsRoutesDependencies,
} from './api';

import { Hono } from 'hono';
import { CONNECTIONS_API_ROUTES, createConnectionsApi } from './api';
import type { ConnectionsRoutesDependencies } from './api';

/**
 * The old Hono router, kept for the connections route tests (which mount it
 * directly with an injected clock, and through `createApp`): every route is
 * served by the Effect handler above, registered without the `/api` prefix so
 * `app.route('/api', …)` keeps working.
 */
export function createConnectionsRoutes(deps: ConnectionsRoutesDependencies): Hono {
  const api = createConnectionsApi(deps);
  const routes = new Hono();
  for (const route of CONNECTIONS_API_ROUTES) {
    const local = route.path.replace(/^\/api/, '');
    routes.on(route.method, local, (context) => api.handler(context.req.raw));
  }
  return routes;
}
