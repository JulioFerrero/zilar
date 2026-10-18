// The outer HTTP edge. In order: request id, masked request log (also for a
// throw), CORS and the origin guard on `/api/*`, `/api/auth/*` to
// `auth.handler`, each mount route, then `/health`, 404 and the error envelope.
//
// `/api/auth/*` is checked before any mount route, so it keeps precedence.
// Defects are caught and rendered through the same envelope as before.

import { Cause, Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config';
import { HttpError } from '../errors';
import { CLIENT_IP_HEADER, clientIpFrom } from '../http/client-ip';
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

// The socket address the edge reports when the transport has no peer socket.
const NO_SOCKET = 'unknown';

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
  /** Served by a Node server; dispatch then reads `request.remoteAddress`. */
  layer: Layer.Layer<never, unknown, HttpRouter.HttpRouter>;
}

// Better Auth cannot read TRUSTED_PROXY_HOPS, so the edge resolves the IP once
// with the limiters' rule. An incoming CLIENT_IP_HEADER is overwritten, so a
// client cannot choose its own.
function withClientIp(request: Request, socketAddress: string, trustedProxyHops: number): Request {
  const headers = new Headers(request.headers);
  const forwardedFor = headers.get('x-forwarded-for') ?? undefined;
  // `'unknown'` means no peer socket (the web handler used by tests). Only then
  // treat X-Forwarded-For as a one-hop stand-in; a real socket never does.
  const hops = trustedProxyHops > 0 || socketAddress !== NO_SOCKET ? trustedProxyHops : 1;
  headers.set(CLIENT_IP_HEADER, clientIpFrom({ forwardedFor, socketAddress }, hops));
  return new Request(request, { headers });
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
    // HEAD routes as GET (as before). Under `toWebHandler` the Effect layer
    // strips the body; under `NodeHttpServer` Node does. Logging, preflight and
    // the origin guard keep the raw method.
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
      const socketAddress = Option.getOrElse(request.remoteAddress, () => NO_SOCKET);
      // CORS preflight on /api/* answers before the origin guard and routing.
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

      // Unsafe methods with a disallowed Origin answer 403 before anything runs.
      if (isApi && origin && UNSAFE_METHODS.has(method) && allowedOrigin === null) {
        const forbidden = new HttpError(403, 'forbidden', 'Origin is not allowed');
        const response = withId(
          cors(HttpServerResponse.jsonUnsafe(errorBody(requestId, forbidden), { status: 403 })),
        );
        logRequest(response.status);
        return response;
      }

      // Auth passthrough keeps precedence over mounts.
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const authRequest = withClientIp(webRequest, socketAddress, config.TRUSTED_PROXY_HOPS);
        const webResponse = yield* Effect.promise(() => auth.handler(authRequest));
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

    // An HttpError renders with its status; anything else is logged and renders
    // the 500 envelope. A throw still gets a request-log line.
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
