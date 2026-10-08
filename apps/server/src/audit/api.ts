// Audit module on the Effect `HttpApi` adapter (T-0525): the same method,
// path, query rules and answers as the deleted Hono router (`routes.ts`),
// mounted under Hono by `apps/server/src/effect/http.ts`. Handlers keep calling
// the drizzle service; the DB rewrite is a separate lane.
//
// `createAuditRoutes` is kept here (and re-exported by the old `routes.ts`
// path) because the unchanged Hono-level `audit/routes.test.ts` builds its own
// Hono and mounts that factory under `/api`.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import { Hono } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import { pino, type Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  mountEffectRoutes,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import {
  MAX_AUDIT_LIST_LIMIT,
  listAuditForAi,
  listAuditForGroup,
  type ListAuditPage,
} from './service';

// Replaces `querySchema` (zod): one of `groupId` / `aiId`, never both; `limit`
// coerced from a string to a positive integer within range, exactly like the
// old `z.coerce.number().int().min(1).max(...)`; optional `before`. Strict, so
// an excess key fails like the old `.strict()`.
const AuditQuery = Schema.Struct({
  groupId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  aiId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: MAX_AUDIT_LIST_LIMIT }),
    ),
  ),
  before: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

// The public shape of one audit row. The handler answers a raw JSON response
// (the service returns `Date`s, serialised by `JSON.stringify`), so this schema
// only declares the success type.
const AuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  aiId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  action: Schema.String,
  subjectId: Schema.NullOr(Schema.String),
  argsHash: Schema.NullOr(Schema.String),
  cost: Schema.NullOr(
    Schema.Struct({ currency: Schema.Literals(['EUR', 'USD']), amount: Schema.Number }),
  ),
  result: Schema.Literals(['ok', 'denied', 'error']),
  detail: Schema.NullOr(Schema.Unknown),
  actorUserId: Schema.NullOr(Schema.String),
});

const AuditPage = Schema.Struct({
  entries: Schema.Array(AuditEntry),
  next: Schema.NullOr(Schema.String),
});

// Any query decode failure is the fixed text `Invalid audit query`, exactly
// like the old route.
class AuditSchemaErrors extends HttpApiMiddleware.Service<AuditSchemaErrors>()(
  'zilar/effect/http/AuditSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<AuditSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(AuditSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', 'Invalid audit query'),
      );
    }),
  );
}

// The service throws `Error('Invalid cursor')` for a malformed `before`; the
// old route mapped just that message to 400, and every other rejection stayed
// an unhandled 500. Both travel as defects so the envelope renders them.
function listPage(promise: () => Promise<ListAuditPage>): Effect.Effect<ListAuditPage> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) =>
      Effect.die(
        defect instanceof Error && defect.message === 'Invalid cursor'
          ? new HttpError(400, 'invalid_request', 'Invalid cursor')
          : defect,
      ),
    ),
  );
}

const AuditGroup = HttpApiGroup.make('audit')
  .add(
    HttpApiEndpoint.get('list', '/audit', {
      query: AuditQuery,
      success: AuditPage,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(AuditSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const AuditApi = HttpApi.make('audit').add(AuditGroup);

export interface AuditApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
}

export interface AuditRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger?: Logger;
}

export const AUDIT_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/audit' },
];

export function createAuditApi(deps: AuditApiDependencies): EffectApiMount {
  const logger = deps.logger;

  const groupLayer = HttpApiBuilder.group(AuditApi, 'audit', (handlers) =>
    handlers
      // The caller's audit rows: a group's (owner/admin) or an AI's (owner).
      // Unknown scopes answer an empty page, never a 404.
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const { groupId, aiId, limit, before } = request.query;
            const hasGroup = groupId !== undefined;
            const hasAi = aiId !== undefined;
            if (hasGroup === hasAi) {
              return httpErrorResponse(
                requestId,
                new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId'),
              );
            }
            const options = {
              ...(limit === undefined ? {} : { limit }),
              ...(before === undefined ? {} : { before }),
            };
            if (hasGroup && groupId !== undefined) {
              const page = yield* listPage(() =>
                listAuditForGroup(deps.db, groupId, user.id, options),
              );
              return HttpServerResponse.jsonUnsafe({ entries: page.entries, next: page.next });
            }
            if (hasAi && aiId !== undefined) {
              const page = yield* listPage(() => listAuditForAi(deps.db, aiId, user.id, options));
              return HttpServerResponse.jsonUnsafe({ entries: page.entries, next: page.next });
            }
            return httpErrorResponse(
              requestId,
              new HttpError(400, 'invalid_request', 'Provide exactly one of groupId or aiId'),
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(AuditApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: AUDIT_API_ROUTES };
}

let silentLogger: Logger | undefined;

function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

/**
 * Compatibility factory for the unchanged Hono-level `audit/routes.test.ts`,
 * which mounts it under `/api` on its own Hono. It builds the Effect mount and
 * registers the module routes relative to the mount prefix; production wiring
 * in `app.ts` uses {@link createAuditApi} with {@link mountEffectRoutes}.
 */
export function createAuditRoutes(deps: AuditRoutesDependencies): Hono<{
  Variables: RequestIdVariables;
}> {
  const api = createAuditApi({ ...deps, logger: deps.logger ?? defaultLogger() });
  const routes = new Hono<{ Variables: RequestIdVariables }>();
  // The caller mounts this sub-app under `/api`, so strip the adapter prefix.
  const relative = api.routes.map((route): EffectApiRoute => ({
    ...route,
    path: route.path.replace(/^\/api/, ''),
  }));
  mountEffectRoutes(routes, relative, api.handler);
  return routes;
}
