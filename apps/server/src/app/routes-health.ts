import type { EdgeHealth } from '../effect/edge';
import { createHealthCheck } from '../health';
import type { RouteWiring } from './deps';

export function healthRoutes({ deps, base }: RouteWiring): () => Promise<EdgeHealth> {
  return createHealthCheck({ db: base.db, adminClient: deps.adminClient });
}
