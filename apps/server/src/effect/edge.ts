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

import { Cause, Context, Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config';
import { HttpError } from '../errors';
import { REQUEST_ID_HEADER, SOCKET_ADDRESS_HEADER, type EffectApiMount } from './http-core';

const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id';
const REQUEST_ID_LIMIT = 255;
const REQUEST_ID_PATTERN = /[^\w\-=]/;

const CORS_ALLOW_METHODS = 'GET,HEAD,PUT,POST,DELETE,PATCH,QUERY';

// The real TCP socket address never reaches the router through
// `HttpServerRequest.remoteAddress`: `HttpRouter.toWebHandler` wraps the
// inbound Web `Request` via `HttpServerRequest.fromWeb`, which sets no
// `remoteAddressOverride`, so it is always `Option.none()` — even in
// production. `serve({ fetch })` still calls `fetch(request, env)` with the
// node bindings as the second argument, so `fetch` reads the address from
// there and carries it into the dispatch through this tag. Without it every
// per-IP limiter would share one `'unknown'` bucket.
class SocketAddressOverride extends Context.Service<SocketAddressOverride, string>()(
  'zilar/effect/edge/SocketAddressOverride',
) {}

// The `incoming` half of the `serve({ fetch })` bindings
// (`HttpBindings | Http2Bindings`): only the socket address is read.
// Structural on purpose: the edge takes no hono types.
export interface ServeBindings {
  readonly incoming?: {
    readonly socket?: { readonly remoteAddress?: unknown };
  };
}

// Same read as the old Hono edge (`getConnInfo(c).remote.address` with the
// same `'unknown'` fallback): a missing/non-string address means no socket.
function socketAddressOfBindings(bindings: unknown): string | undefined {
  if (typeof bindings !== 'object' || bindings === null) {
    return undefined;
  }
  const address = (bindings as ServeBindings).incoming?.socket?.remoteAddress;
  return typeof address === 'string' && address.length > 0 ? address : undefined;
}

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
  fetch: (request: Request, bindings?: ServeBindings) => Promise<Response>;
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  routes: ReadonlyArray<EdgeRoute>;
  dispose: () => Promise<void>;
  /**
   * The same `appLayer` the web handler uses, so a Node server can serve it
   * (B1.6: `HttpRouter.serve(app.layer, …)` with `NodeHttpServer.layer`).
   * `fetch`/`request` callers keep the `SocketAddressOverride` path; under
   * `NodeHttpServer` the dispatch falls back to `request.remoteAddress`, the
   * real socket address.
   */
  layer: Layer.Layer<never, unknown, HttpRouter.HttpRouter>;
}

interface CompiledRoute {
  readonly method: string;
  readonly segments: ReadonlyArray<string>;
  readonly handler: (request: Request) => Promise<Response>;
}

function splitPattern(path: string): ReadonlyArray<string> {
  return path.split('/').slice(1);
}

function splitPathname(pathname: string): ReadonlyArray<string> {
  return pathname.split('/').slice(1).map(decodeSegment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchesRoute(route: CompiledRoute, segments: ReadonlyArray<string>): boolean {
  if (route.segments.length !== segments.length) {
    return false;
  }
  for (let index = 0; index < route.segments.length; index += 1) {
    const pattern = route.segments[index];
    if (pattern === undefined || pattern.startsWith(':')) {
      continue;
    }
    if (pattern !== segments[index]) {
      return false;
    }
  }
  return true;
}

export function resolveRequestId(inbound: string | null): string {
  if (
    inbound !== null &&
    inbound.length > 0 &&
    inbound.length <= REQUEST_ID_LIMIT &&
    !REQUEST_ID_PATTERN.test(inbound)
  ) {
    return inbound;
  }
  return crypto.randomUUID();
}

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function allowedOrigins(config: ServerConfig): string[] {
  const origins = new Set(config.WEB_ORIGINS);
  origins.add(new URL(config.PUBLIC_URL).origin);
  origins.add(new URL(config.BETTER_AUTH_URL).origin);
  return [...origins];
}

// Join tokens (T-0115), sign-up invite codes, GIF media tokens (T-0122) and
// avatar ids (unguessable uuids) are bearer secrets, so the request log
// redacts every segment after `/api/join/`, `/api/invites/`,
// `/api/gifs/media/` and `/api/avatars/`
// (`/api/join/<token>` and any variant such as a trailing slash, which 404s in
// routing but still reaches this log line).
export function logPath(path: string): string {
  if (path.startsWith('/api/join/')) {
    return '/api/join/:token';
  }
  if (path.startsWith('/api/gifs/media/')) {
    return '/api/gifs/media/:token';
  }
  if (path.startsWith('/api/avatars/')) {
    return '/api/avatars/:id';
  }
  return path.startsWith('/api/invites/') ? '/api/invites/:code' : path;
}

export function statusFor(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

export function durationSince(start: number): number {
  return Math.round(performance.now() - start);
}

function errorBody(requestId: string, error: HttpError): unknown {
  return {
    error: {
      ...error.detail,
      code: error.code,
      message: error.message,
      requestId,
    },
  };
}

function internalErrorBody(requestId: string): unknown {
  return {
    error: {
      code: 'internal_error',
      message: 'Internal server error',
      requestId,
    },
  };
}

function appendVary(
  response: HttpServerResponse.HttpServerResponse,
  value: string,
): HttpServerResponse.HttpServerResponse {
  const existing = response.headers['vary'];
  if (existing === undefined) {
    return HttpServerResponse.setHeader('Vary', value)(response);
  }
  const values = existing.split(',').map((entry) => entry.trim());
  if (values.includes(value)) {
    return response;
  }
  return HttpServerResponse.setHeader('Vary', `${existing}, ${value}`)(response);
}

// Hono CORS parity on `/api/*`: an allowed request `Origin` is echoed with
// `Access-Control-Allow-Origin`, credentials are always on, preflight
// (`OPTIONS`) answers here with the allow-methods list and echoes the
// requested headers, and `Vary: Origin` is set on every `/api` response. A
// disallowed or absent origin gets no allow-origin header (but keeps the
// credentials flag and the Vary, as Hono does).
function applyCors(
  response: HttpServerResponse.HttpServerResponse,
  allowedOrigin: string | null,
  preflightHeaders: string | undefined,
  preflight: boolean,
): HttpServerResponse.HttpServerResponse {
  let result = response;
  if (allowedOrigin !== null) {
    result = HttpServerResponse.setHeader('Access-Control-Allow-Origin', allowedOrigin)(result);
  }
  result = HttpServerResponse.setHeader('Access-Control-Allow-Credentials', 'true')(result);
  if (preflight) {
    result = HttpServerResponse.setHeader(
      'Access-Control-Allow-Methods',
      CORS_ALLOW_METHODS,
    )(result);
    if (preflightHeaders !== undefined && preflightHeaders.length > 0) {
      const headers = preflightHeaders
        .split(',')
        .map((header) => header.trim())
        .filter((header) => header.length > 0)
        .join(',');
      if (headers.length > 0) {
        result = HttpServerResponse.setHeader('Access-Control-Allow-Headers', headers)(result);
        result = appendVary(result, 'Access-Control-Request-Headers');
      }
    }
  }
  return appendVary(result, 'Origin');
}

function withRequestIdHeader(
  response: HttpServerResponse.HttpServerResponse,
  requestId: string,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(REQUEST_ID_RESPONSE_HEADER, requestId)(response);
}

function mergePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function forwardEdgeRequest(request: Request, requestId: string, socketAddress: string): Request {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  // Strip any client-forged value first: only the edge may set it.
  headers.delete(SOCKET_ADDRESS_HEADER);
  headers.set(SOCKET_ADDRESS_HEADER, socketAddress);
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
      // The socket address `serve({ fetch })` saw: the per-request override
      // `fetch` stamped from the node bindings, else the router's own
      // `remoteAddress` (always none under `toWebHandler`), else `'unknown'`
      // — the same fallback as the old Hono edge.
      const override = yield* Effect.serviceOption(SocketAddressOverride);
      const socketAddress = Option.isSome(override)
        ? override.value
        : Option.getOrElse(request.remoteAddress, () => 'unknown');
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
    // `serve({ fetch })` calls `fetch(request, env)` with the node bindings
    // as the second argument; the socket address is read from there (see
    // `SocketAddressOverride`). The parameter stays optional so direct
    // callers get the `'unknown'` fallback.
    fetch: (request: Request, bindings?: ServeBindings) => {
      const address = socketAddressOfBindings(bindings);
      const requestContext =
        address === undefined ? undefined : Context.make(SocketAddressOverride, address);
      return handler(request, requestContext);
    },
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
