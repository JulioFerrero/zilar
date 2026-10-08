// T-0554: thin Hono wrapper over the Effect routines API (`api.ts`).
// Kept because the unchanged Hono-level `routines/service.test.ts` builds
// its own Hono and mounts this factory under `/api`. Production wiring in
// `app.ts` uses `createRoutinesApi` with `mountEffectRoutes` instead.
import { Hono } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import { pino, type Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { mountEffectRoutes, type EffectApiRoute } from '../effect/http';
import { createRoutinesApi } from './api';

export interface RoutinesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so pause/resume/delete timestamps can advance. */
  now?: () => Date;
}

let silentLogger: Logger | undefined;

function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

/**
 * Compatibility factory for the unchanged Hono-level
 * `routines/service.test.ts`, which mounts it under `/api` on its own Hono.
 * It builds the Effect mount and registers the module routes relative to the
 * mount prefix; production wiring in `app.ts` uses `createRoutinesApi` with
 * `mountEffectRoutes`.
 */
export function createRoutinesRoutes(
  deps: RoutinesRoutesDependencies,
): Hono<{ Variables: RequestIdVariables }> {
  const api = createRoutinesApi({ ...deps, logger: defaultLogger() });
  const routes = new Hono<{ Variables: RequestIdVariables }>();
  // The caller mounts this sub-app under `/api`, so strip the adapter prefix.
  const relative = api.routes.map((route): EffectApiRoute => ({
    ...route,
    path: route.path.replace(/^\/api/, ''),
  }));
  mountEffectRoutes(routes, relative, api.handler);
  return routes;
}
