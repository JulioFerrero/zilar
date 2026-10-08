// Compatibility shim for the unchanged Hono-level approvals tests, which
// import `createApprovalsRoutes` from this path and mount it under `/api`.
// The routes now live in `./api`, on the Effect `HttpApi` adapter.

import { Hono } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import pino from 'pino';
import { mountEffectRoutes, type EffectApiRoute } from '../effect/http';
import { createApprovalsApi, type ApprovalsApiDependencies } from './api';

// The minimum slice of pino the route needs to log a hook failure. The
// server wires its own logger; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsRoutesDependencies extends Omit<ApprovalsApiDependencies, 'logger'> {
  /** Logger used to record a hook failure; absent = silent. */
  logger?: ApprovalsRouteLogger;
}

let silentLogger: ReturnType<typeof pino> | undefined;

function defaultLogger(): ReturnType<typeof pino> {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

/**
 * Compatibility factory for the unchanged Hono-level approvals tests, which
 * mount it under `/api` on their own Hono. It builds the Effect mount and
 * registers the module routes relative to the mount prefix; production
 * wiring in `app.ts` uses {@link createApprovalsApi} with
 * {@link mountEffectRoutes}.
 */
export function createApprovalsRoutes({
  logger,
  ...deps
}: ApprovalsRoutesDependencies): Hono<{ Variables: RequestIdVariables }> {
  const api = createApprovalsApi({
    ...deps,
    logger: (logger ?? defaultLogger()) as ApprovalsApiDependencies['logger'],
  });
  const routes = new Hono<{ Variables: RequestIdVariables }>();
  // The caller mounts this sub-app under `/api`, so strip the adapter prefix.
  const relative = api.routes.map((route): EffectApiRoute => ({
    ...route,
    path: route.path.replace(/^\/api/, ''),
  }));
  mountEffectRoutes(routes, relative, api.handler);
  return routes;
}
