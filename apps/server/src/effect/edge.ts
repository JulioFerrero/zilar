// The Effect HTTP edge (T-0730, plan §2.1 architecture A): builds the whole
// outer edge with `effect/http` and dispatches to the existing module web
// handlers. The modules do not change.
//
// Behaviour mirrors `app.ts` before the flip, in the same order:
//  1. the request id (Hono `requestId()` semantics, `x-request-id` in and out),
//  2. the masked request log (also when the request throws),
//  3. CORS + the origin guard on `/api/*`,
//  4. `/api/auth/*` straight to `auth.handler`,
//  5. each mount route with the two forwarded headers,
//  6. `/health`, the 404 catch-all, and the error envelope.
//
// Dispatch notes:
// - One `HttpRouter.use` registration performs the dispatch against the mount
//   route table (Hono-style: exact method plus case-sensitive, strict path
//   match with `:param` segments), so `/api/auth/*` keeps Hono's precedence
//   by being checked before any mount route. Layer-building hundreds of
//   `HttpRouter.add` fragments is avoided.
// - Defects (a throwing module handler, a throwing `auth.handler`, a rejected
//   `health()`) are caught with `Effect.catchCause` and rendered through
//   the same error envelope as `app.onError`; `Cause.defects` carries the
//   original thrown value, checked with `instanceof HttpError` first.

import { Cause, Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config';
import { HttpError } from '../errors';
import {
  allowedOrigins,
  applyCors,
  type CompiledRoute,
  durationSince,
  errorBody,
  forwardEdgeRequest,
  internalErrorBody,
  logPath,
  matchesRoute,
  mergePath,
  resolveRequestId,
  splitPathname,
  splitPattern,
  UNSAFE_METHODS,
  withRequestIdHeader,
} from './edge-request';
import { REQUEST_ID_HEADER, type EffectApiMount } from './http-core';

export { allowedOrigins, durationSince, logPath, resolveRequestId, UNSAFE_METHODS };

export interface EdgeAuth {
  handler: (request: Request) => Promise<Response>;
}

export interface EdgeHealth {
  readonly status: number;
  readonly body: unknown;
}

export interface CreateEdgeInput {
  readonly mounts: ReadonlyArray<EffectApiMount>;
  readonly auth: EdgeAuth;
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly health: () => Promise<EdgeHealth>;
}

export interface EdgeRoute {
  readonly method: string;
  readonly path: string;
}

export interface ZilarEdge {
  fetch: (request: Request) => Promise<Response>;
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  routes: ReadonlyArray<EdgeRoute>;
  dispose: () => Promise<void>;
  /**
   * The same `appLayer` the web handler uses, so a Node server can serve it
   * (B1.6: `HttpRouter.serve(app.layer, …)` with `NodeHttpServer.layer`).
   * Under `NodeHttpServer` the dispatch reads `request.remoteAddress`, the
   * real socket address.
   */
  layer: Layer.Layer<never, unknown, HttpRouter.HttpRouter>;
}

export function createEdge(input: CreateEdgeInput): ZilarEdge {
  const { mounts, auth, config, logger, health } = input;

  const routes: EdgeRoute[] = [{ method: 'ALL', path: '/api/auth/*' }];
  const compiled: CompiledRoute[] = [];
  for (const mount of mounts) {
    for (const route of mount.routes) {
      routes.push({ method: route.method, path: route.path });
      const handler = mount.handler;
      compiled.push({ method: route.method, segments: splitPattern(route.path), handler });
    }
  }
  routes.push({ method: 'GET', path: '/health' });

  const allowed = allowedOrigins(config);

  const respond = (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
    const start = performance.now();
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER] ?? null);
    const method = request.method;
    // Hono parity (`hono-base.js` `#dispatch`): HEAD is routed as GET. Under
    // `toWebHandler` the Effect `HttpEffect` layer strips the body from the
    // final web response; under `NodeHttpServer` Node's `http` omits the body
    // for HEAD itself. Logging, the preflight check and the origin guard keep
    // the raw method.
    const routeMethod = method === 'HEAD' ? 'GET' : method;
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    const segments = splitPathname(pathname);
    const origin = request.headers['origin'];
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const allowedOrigin = origin !== undefined && allowed.includes(origin) ? origin : null;
    const cors = (
      response: HttpServerResponse.HttpServerResponse,
      preflight = false,
      preflightHeaders: string | undefined = undefined,
    ): HttpServerResponse.HttpServerResponse =>
      isApi ? applyCors(response, allowedOrigin, preflightHeaders, preflight) : response;
    const withId = (
      response: HttpServerResponse.HttpServerResponse,
    ): HttpServerResponse.HttpServerResponse => withRequestIdHeader(response, requestId);
    const logRequest = (responseStatus: number): void => {
      logger.info(
        {
          method,
          path: logPath(pathname),
          requestId,
          status: responseStatus,
          durationMs: durationSince(start),
        },
        'request',
      );
    };

    const dispatch = Effect.gen(function* () {
      // The socket address is the Node server's `remoteAddress`, or `'unknown'`
      // when there is no socket (web-handler callers such as tests).
      const socketAddress = Option.getOrElse(request.remoteAddress, () => 'unknown');
      // CORS preflight on /api/* answers here, before the origin guard and
      // routing, like the Hono cors middleware (204, echoed request headers,
      // `Vary: Origin`).
      if (isApi && method === 'OPTIONS') {
        const response = withId(
          cors(
            HttpServerResponse.empty({ status: 204 }),
            true,
            request.headers['access-control-request-headers'],
          ),
        );
        logRequest(response.status);
        return response;
      }

      // Origin guard on /api/*: unsafe methods with a disallowed Origin
      // answer 403 before anything else runs.
      if (isApi && origin && UNSAFE_METHODS.has(method) && allowedOrigin === null) {
        const forbidden = new HttpError(403, 'forbidden', 'Origin is not allowed');
        const response = withId(
          cors(HttpServerResponse.jsonUnsafe(errorBody(requestId, forbidden), { status: 403 })),
        );
        logRequest(response.status);
        return response;
      }

      // better-auth passthrough keeps Hono's precedence over mounts.
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const webResponse = yield* Effect.promise(() => auth.handler(webRequest));
        const response = withId(cors(HttpServerResponse.fromWeb(webResponse)));
        logRequest(response.status);
        return response;
      }

      for (const route of compiled) {
        if (route.method !== routeMethod || !matchesRoute(route, segments)) {
          continue;
        }
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const forwarded = forwardEdgeRequest(webRequest, requestId, socketAddress);
        const webResponse = yield* Effect.promise(() => route.handler(forwarded));
        const response = withId(cors(HttpServerResponse.fromWeb(webResponse)));
        logRequest(response.status);
        return response;
      }

      if (pathname === '/health' && routeMethod === 'GET') {
        const result = yield* Effect.promise(() => health());
        const response = withId(
          HttpServerResponse.jsonUnsafe(result.body, { status: result.status }),
        );
        logRequest(response.status);
        return response;
      }

      const response = withId(
        cors(
          HttpServerResponse.jsonUnsafe(
            { error: { code: 'not_found', message: 'Not found', requestId } },
            { status: 404 },
          ),
        ),
      );
      logRequest(response.status);
      return response;
    });

    // `app.onError` parity: an HttpError renders with its status, anything
    // else is logged and renders the 500 envelope. A request-log line is
    // emitted for throws too, with the rendered status.
    return Effect.catchCause(dispatch, (cause: Cause.Cause<unknown>) => {
      const thrown: unknown = Cause.squash(cause);
      const render = (
        response: HttpServerResponse.HttpServerResponse,
        responseStatus: number,
      ): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
        const withCors = isApi ? applyCors(response, allowedOrigin, undefined, false) : response;
        logRequest(responseStatus);
        return Effect.succeed(withRequestIdHeader(withCors, requestId));
      };
      if (thrown instanceof HttpError) {
        return render(
          HttpServerResponse.jsonUnsafe(errorBody(requestId, thrown), {
            status: thrown.status,
          }),
          thrown.status,
        );
      }
      logger.error(
        { err: thrown === undefined ? cause : thrown, requestId },
        'unhandled request error',
      );
      return render(
        HttpServerResponse.jsonUnsafe(internalErrorBody(requestId), { status: 500 }),
        500,
      );
    });
  };

  const appLayer = HttpRouter.use((router) => router.add('*', '/*', respond)).pipe(
    Layer.provide(HttpServer.layerServices),
  );

  const { handler, dispose } = HttpRouter.toWebHandler(appLayer, { disableLogger: true });

  const edgeRoutes: ReadonlyArray<EdgeRoute> = routes;

  return {
    fetch: (request: Request) => handler(request),
    request: (requestInput: string | URL | Request, init?: RequestInit) => {
      if (requestInput instanceof Request) {
        return handler(init === undefined ? requestInput : new Request(requestInput, init));
      }
      const target = requestInput.toString();
      return handler(
        new Request(
          /^https?:\/\//.test(target) ? target : `http://localhost${mergePath(target)}`,
          init,
        ),
      );
    },
    routes: edgeRoutes,
    dispose,
    layer: appLayer,
  };
}
