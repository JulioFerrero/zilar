// The files Hono router moved onto the Effect `HttpApi` adapter (T-0580):
// `createFilesApi` in `./api` serves the route. This module keeps the deps
// type, the rate-limit and fetch-timeout constants, and `createFilesRoutes`
// as a thin item-11 wrapper, because the files route tests mount it directly
// with an injected `fetchImpl` and `now`.
import { Hono } from 'hono';
import { createFilesApi, FILES_API_ROUTES, type FilesRoutesDependencies } from './api';

export {
  FILES_API_ROUTES,
  FILES_FETCH_TIMEOUT_MS,
  FILES_RATE_LIMIT_MAX,
  FILES_RATE_LIMIT_WINDOW_MS,
  createFilesApi,
} from './api';
export type { FilesRoutesDependencies } from './api';

/**
 * The old Hono router, kept for the files route tests (which build a Hono app
 * around it with an injected fetch): the route is served by the Effect
 * handler above, registered without the `/api` prefix so `app.route('/api',
 * …)` keeps working.
 */
export function createFilesRoutes(deps: FilesRoutesDependencies): Hono {
  const api = createFilesApi(deps);
  const routes = new Hono();
  for (const route of FILES_API_ROUTES) {
    const local = route.path.replace(/^\/api/, '');
    routes.on(route.method, local, (context) => api.handler(context.req.raw));
  }
  return routes;
}
