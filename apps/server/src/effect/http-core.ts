// The Hono-free core shared by every Effect HTTP module (T-0694, plan §4
// B1.1): the session middleware, the request-id and socket-address readers,
// the one error envelope, and the route types a module hands back to `app.ts`.
// This file must never import the edge framework packages; the edge that
// mounts these handlers lives in `./edge.ts`.
//
// One error encoding: any handler failure is rendered exactly like
// `app.onError` — `HttpError` as `{ error: { ...detail, code, message,
// requestId } }` with its status, anything else as the 500 `internal_error`
// branch. The request id Hono generated is forwarded as the `x-request-id`
// header so both branches can carry it.

import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiMiddleware, type HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { HttpError } from '../errors';

export const REQUEST_ID_HEADER = 'x-request-id';
export const SOCKET_ADDRESS_HEADER = 'x-zilar-socket-address';

/** The slice of the signed-in user an Effect handler may read. */
export interface SessionUser {
  readonly id: string;
}

/** Provided by the session middleware; handlers read the current user id. */
export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()(
  'zilar/effect/http/CurrentUser',
) {}

/**
 * Session middleware: every endpoint of a group that declares it requires a
 * signed-in user. An absent session short-circuits with the same body as
 * `requireSession`, before any query or body decoding runs.
 */
export class Session extends HttpApiMiddleware.Service<
  Session,
  {
    provides: CurrentUser;
  }
>()('zilar/effect/http/Session') {}

export function sessionLayer(auth: Auth, logger: Logger): Layer.Layer<Session> {
  return Layer.succeed(
    Session,
    Session.of(
      Effect.fnUntraced(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        // T-0858: only reads trust the session cache cookie. A write looks the
        // session up without it, so a revoked session cannot write. The
        // handler still sees the untouched request.
        const lookupHeaders = isReadMethod(request.method)
          ? new Headers(request.headers)
          : headersWithoutSessionCache(request.headers);
        // A rejection from the auth store is a defect outside the handler
        // envelope; render it through the same 500 branch as `app.onError`.
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: lookupHeaders }),
        ).pipe(
          Effect.catchDefect((defect) =>
            Effect.succeed(failureResponse(logger, requestId, defect)),
          ),
        );
        if (HttpServerResponse.isHttpServerResponse(session)) {
          return session;
        }
        if (!session) {
          return httpErrorResponse(
            requestId,
            new HttpError(401, 'unauthorized', 'Authentication required'),
          );
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, { id: session.user.id });
      }),
    ),
  );
}

/**
 * Schema-error middleware, shared by every module: a params, query or payload
 * decode failure renders as 400 `invalid_request` through the shared envelope.
 * A group declares it with `.middleware(SchemaErrors)` and the module provides
 * `schemaErrorLayer(logger)`.
 */
export class SchemaErrors extends HttpApiMiddleware.Service<SchemaErrors>()(
  'zilar/effect/http/SchemaErrors',
) {}

export function schemaErrorLayer(logger: Logger): Layer.Layer<SchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

// Better Auth names the cache cookie `<prefix>session_data`, in chunks
// (`session_data.0`) when large.
function headersWithoutSessionCache(source: Record<string, string>): Headers {
  const headers = new Headers(source);
  const cookie = headers.get('cookie');
  if (cookie !== null) {
    const kept = cookie
      .split(';')
      .map((pair) => pair.trim())
      .filter((pair) => pair !== '' && !pair.split('=')[0]?.includes('session_data'));
    headers.set('cookie', kept.join('; '));
  }
  return headers;
}

export function requestIdOf(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers[REQUEST_ID_HEADER] ?? '';
}

/**
 * Reads the socket address `forwardRequest` stamped onto the request. A
 * client can never forge it: the header is deleted and re-set at the edge.
 */
export function socketAddressOf(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers[SOCKET_ADDRESS_HEADER] ?? 'unknown';
}

/**
 * The `HttpError` branch of `app.onError`, byte-identical to its body:
 * `detail` keys can never overwrite `code`, `message` or `requestId`.
 */
export function httpErrorResponse(
  requestId: string,
  error: HttpError,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        ...error.detail,
        code: error.code,
        message: error.message,
        requestId,
      },
    },
    { status: error.status },
  );
}

/** The unknown-failure branch of `app.onError`: log, then a 500 envelope. */
export function failureResponse(
  logger: Logger,
  requestId: string,
  cause: unknown,
): HttpServerResponse.HttpServerResponse {
  if (cause instanceof HttpError) {
    return httpErrorResponse(requestId, cause);
  }
  logger.error({ err: cause, requestId }, 'unhandled request error');
  return HttpServerResponse.jsonUnsafe(
    { error: { code: 'internal_error', message: 'Internal server error', requestId } },
    { status: 500 },
  );
}

/**
 * Runs an endpoint handler and renders every failure through the shared
 * envelope. Handler bodies lift promise rejections as defects (Effect.promise),
 * so `catchDefect` sees the original error and never swallows typed failures
 * or interruption.
 */
export function withErrorEnvelope<A, R>(
  effect: Effect.Effect<A, never, R>,
  logger: Logger,
  requestId: string,
): Effect.Effect<A | HttpServerResponse.HttpServerResponse, never, R> {
  return effect.pipe(
    Effect.catchDefect((defect) => Effect.succeed(failureResponse(logger, requestId, defect))),
  );
}

/**
 * The endpoint handler every module repeats: reads the request id, the signed-in
 * user, runs `body(request, user)` and renders every defect through the shared
 * envelope. `body` may return a Promise (a rejection is a defect, like
 * `Effect.promise`) or an Effect that cannot fail. Use it as
 * `.handle('name', handler(logger, (request, user) => service(user.id, request.params.id)))`.
 * The group must declare `Session`, which provides `CurrentUser`.
 */
export function handler<
  Req extends { readonly request: HttpServerRequest.HttpServerRequest },
  A,
  R = never,
>(
  logger: Logger,
  body: (request: Req, user: SessionUser) => Promise<A> | Effect.Effect<A, never, R>,
): (
  request: Req,
) => Effect.Effect<A | HttpServerResponse.HttpServerResponse, never, R | CurrentUser> {
  return (request) =>
    withErrorEnvelope(
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        return yield* Effect.suspend(() => {
          const out = body(request, user);
          return Effect.isEffect(out) ? out : Effect.promise(() => out);
        });
      }),
      logger,
      requestIdOf(request.request),
    );
}

export type EffectApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EffectApiRoute {
  readonly method: EffectApiMethod;
  readonly path: string;
}

export type EffectApiWebHandler = (request: Request) => Promise<Response>;

/** What a module hands back to `app.ts`: the fetch handler and its routes. */
export interface EffectApiMount {
  readonly handler: EffectApiWebHandler;
  readonly routes: ReadonlyArray<EffectApiRoute>;
}

/**
 * The routes of an `HttpApi`, in the `{ method, path }` shape the edge routes
 * by. The group's `.prefix('/api')` is already part of each endpoint path.
 */
export function reflectRoutes<Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): ReadonlyArray<EffectApiRoute> {
  const routes: Array<EffectApiRoute> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      routes.push({ method: endpoint.method as EffectApiMethod, path: endpoint.path });
    },
  });
  return routes;
}

/**
 * The shared mount: serves the API layer as a web handler and lists its routes
 * from the API itself, so a module keeps no hand-written route array. The
 * edge keeps the request log (redacted path); the router's own logger prints
 * full URLs, so it stays off. Failures are logged by the envelope instead.
 */
export function mountApi<Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
  apiLayer: Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | Layer.Success<typeof HttpServer.layerServices>
  >,
): EffectApiMount {
  const { handler: webHandler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );
  return { handler: webHandler, routes: reflectRoutes(api) };
}
