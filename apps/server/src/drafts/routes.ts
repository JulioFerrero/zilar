// The item-11 wrapper (EFFECT_GUIDE): `createDraftsRoutes` keeps the old
// Hono factory signature for the tests that mount it directly, but the route
// is served by the Effect `HttpApi` handler in `./api`.
import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { createDraftsApi, DRAFTS_API_ROUTES } from './api';
import { sharedDraftHub, type DraftHub } from './hub';

export { DRAFT_SSE_HEARTBEAT_MS } from './api';

export interface DraftsRoutesDependencies {
  auth: Auth;
  hub?: DraftHub;
}

/**
 * Compatibility factory for the unchanged Hono-level `routes.test.ts`, which
 * mounts it under `/api` on its own Hono. It builds the Effect mount and
 * registers the module route relative to the mount prefix; production wiring
 * in `app.ts` uses `createDraftsApi` with `mountEffectRoutes`.
 */
export function createDraftsRoutes({ auth, hub = sharedDraftHub }: DraftsRoutesDependencies): Hono {
  const api = createDraftsApi({ auth, hub });
  const routes = new Hono();
  for (const route of DRAFTS_API_ROUTES) {
    const local = route.path.replace(/^\/api/, '');
    routes.on(route.method, local, (context) => {
      // The Effect router matches the full `/api`-prefixed path, so rewrite
      // the local test URL back to it before forwarding.
      const url = new URL(context.req.raw.url);
      url.pathname = `${route.path}${url.pathname.slice(local.length)}`;
      return api.handler(new Request(url, context.req.raw));
    });
  }
  return routes;
}
