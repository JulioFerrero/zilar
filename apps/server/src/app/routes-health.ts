// The `/health` probe (T-1460, plan #48). Unlike the route-area siblings this
// returns the health check itself, not a mount: the edge serves it directly.
import type { EdgeHealth } from '../effect/edge';
import { createHealthCheck } from '../health';
import type { RouteWiring } from './deps';

/** Builds the `/health` handler from the shared database and admin client. */
export function healthRoutes({ deps, base }: RouteWiring): () => Promise<EdgeHealth> {
  return createHealthCheck({ db: base.db, adminClient: deps.adminClient });
}
