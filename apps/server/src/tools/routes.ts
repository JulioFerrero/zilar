// T-0559: thin Hono wrapper over the Effect tools API (`api.ts`).
// Kept because the unchanged Hono-level `tools/routes.test.ts` mounts this
// factory directly (line 119) and imports `TOOL_RUN_RATE_LIMIT_MAX` from
// here. Production wiring in `app.ts` uses `createToolsApi` with
// `mountEffectRoutes` instead.
import { Hono } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import { pino, type Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { mountEffectRoutes, type EffectApiRoute } from '../effect/http';
import {
  createToolsApi,
  MAX_TOOL_RUN_INPUT_BYTES,
  TOOL_RUN_RATE_LIMIT_MAX,
  TOOL_RUN_RATE_LIMIT_WINDOW_MS,
} from './api';
import type { ToolRunner } from './types';

export { MAX_TOOL_RUN_INPUT_BYTES, TOOL_RUN_RATE_LIMIT_MAX, TOOL_RUN_RATE_LIMIT_WINDOW_MS };

export interface ToolsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Absent = no runner (T-0105 wires the sandbox): run answers 501. */
  toolRunner?: ToolRunner;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

let silentLogger: Logger | undefined;

function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

/**
 * Compatibility factory for the unchanged Hono-level
 * `tools/routes.test.ts`, which mounts it under `/api` on its own Hono.
 * It builds the Effect mount and registers the module routes relative to the
 * mount prefix; production wiring in `app.ts` uses `createToolsApi` with
 * `mountEffectRoutes`.
 */
export function createToolsRoutes({
  auth,
  db,
  audit,
  toolRunner,
  now = Date.now,
}: ToolsRoutesDependencies): Hono<{ Variables: RequestIdVariables }> {
  const api = createToolsApi({
    auth,
    db,
    logger: defaultLogger(),
    ...(audit === undefined ? {} : { audit }),
    ...(toolRunner === undefined ? {} : { toolRunner }),
    now,
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
