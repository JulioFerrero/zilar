// The strangler HTTP adapter (T-0498, plan §2.1/§4.2): mount an Effect
// `HttpApi` under Hono one route module at a time. Hono stays the edge
// (request id, request log, CORS, origin guard, better-auth); the module
// behind it is an Effect handler turned into a fetch handler by
// `HttpRouter.toWebHandler`.
//
// One error encoding: any handler failure is rendered exactly like
// `app.onError` — `HttpError` as `{ error: { ...detail, code, message,
// requestId } }` with its status, anything else as the 500 `internal_error`
// branch. The request id Hono generated is forwarded as the `x-request-id`
// header so both branches can carry it.

import { Context, Effect, Layer } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
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
        // A rejection from the auth store is a defect outside the handler
        // envelope; render it through the same 500 branch as `app.onError`.
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers(request.headers) }),
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

type ServerApp = Hono<{ Variables: RequestIdVariables }>;

function forwardRequest(context: HonoContext<{ Variables: RequestIdVariables }>): Request {
  const headers = new Headers(context.req.raw.headers);
  const requestId = context.get('requestId');
  if (requestId) {
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  // Strip any client-forged value first: only the edge may set it.
  headers.delete(SOCKET_ADDRESS_HEADER);
  headers.set(SOCKET_ADDRESS_HEADER, readSocketAddress(context));
  return new Request(context.req.raw, { headers });
}

// The socket address as the server sees it: the same `getConnInfo` read
// with the same `'unknown'` fallback as the Hono route modules use.
function readSocketAddress(context: HonoContext<{ Variables: RequestIdVariables }>): string {
  try {
    const address = getConnInfo(context).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Mounts a fetch handler under a Hono prefix: the exact prefix and everything
 * below it. Prefer {@link mountEffectRoutes} for module routes, so the authz
 * sweep still sees each method and path.
 */
export function mountEffectApi(
  app: ServerApp,
  prefix: string,
  webHandler: EffectApiWebHandler,
): void {
  const handler = (context: HonoContext<{ Variables: RequestIdVariables }>) =>
    webHandler(forwardRequest(context));
  app.all(prefix, handler);
  app.all(`${prefix}/*`, handler);
}

/**
 * Mounts a fetch handler on exact Hono method + path pairs. The routes keep
 * the shape of the previous `app.route(...)` registration, so `app.routes`
 * (and the 401 authorization sweep) sees the same methods and paths.
 */
export function mountEffectRoutes(
  app: ServerApp,
  routes: ReadonlyArray<EffectApiRoute>,
  webHandler: EffectApiWebHandler,
): void {
  for (const route of routes) {
    app.on(route.method, route.path, (context) => webHandler(forwardRequest(context)));
  }
}
