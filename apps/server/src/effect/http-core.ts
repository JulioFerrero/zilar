// The core shared by every Effect HTTP module: session middleware, request-id
// and socket-address readers, and the one error envelope. This file must never
// import the edge packages; the edge lives in `./edge.ts`.
//
// `HttpError` renders with its status, anything else as the 500 branch, and both
// carry the request id.

import { CurrentUser, SchemaErrors, Session, type SessionUser } from '@zilar/api-contract';
import { Effect, Layer, type Context } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiMiddleware,
  type HttpApiError,
  type HttpApiGroup,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { HttpError } from '../errors';

export const REQUEST_ID_HEADER = 'x-request-id';
export const SOCKET_ADDRESS_HEADER = 'x-zilar-socket-address';

// An absent session short-circuits before any query or body decoding runs.
export { CurrentUser, SchemaErrors, Session, type SessionUser };

export function sessionLayer(auth: Auth, logger: Logger): Layer.Layer<Session> {
  return Layer.succeed(
    Session,
    Session.of(
      Effect.fnUntraced(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        // Only reads trust the session cache cookie, so a revoked session cannot
        // write; the handler still sees the untouched request.
        const lookupHeaders = isReadMethod(request.method)
          ? new Headers(request.headers)
          : headersWithoutSessionCache(request.headers);
        // A rejected auth lookup is a defect; render it through the 500 branch.
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

export type SchemaErrorTag<Id> = Context.Service<
  Id,
  HttpApiMiddleware.HttpApiMiddleware<never, never, never>
>;

/**
 * A fixed message, or a function returning an `HttpError` or a full response.
 */
export type SchemaErrorRender =
  | string
  | ((
      error: HttpApiError.HttpApiSchemaError,
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpError | HttpServerResponse.HttpServerResponse>);

/**
 * A decode failure renders as 400 `invalid_request` through the shared envelope.
 * With no `render` the message is the schema's own text; a string is fixed.
 */
export function schemaErrorLayer(logger: Logger): Layer.Layer<SchemaErrors> {
  return schemaErrorLayerFor(SchemaErrors, logger);
}

export function schemaErrorLayerFor<Id>(
  tag: SchemaErrorTag<Id>,
  logger: Logger,
  render?: SchemaErrorRender,
): Layer.Layer<Id> {
  return HttpApiMiddleware.layerSchemaErrorTransform(tag, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const answer =
        typeof render === 'function'
          ? yield* render(error, request)
          : new HttpError(400, 'invalid_request', render ?? error.cause.message);
      return HttpServerResponse.isHttpServerResponse(answer)
        ? answer
        : failureResponse(logger, requestIdOf(request), answer);
    }),
  );
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

// Better Auth names the cookie `<prefix>session_data`, chunked when large.
export function headersWithoutSessionCache(source: Headers | Record<string, string>): Headers {
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
 * The edge deletes and re-sets this header, so a client can never forge it.
 */
export function socketAddressOf(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers[SOCKET_ADDRESS_HEADER] ?? 'unknown';
}

/**
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
 * Handler bodies lift promise rejections as defects, so `catchDefect` sees the
 * original error and never swallows typed failures or interruption.
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
 * Reads the request id and the signed-in user, runs `body` and renders every
 * defect through the shared envelope. The group must declare `Session`.
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

export interface EffectApiMount {
  readonly handler: EffectApiWebHandler;
  readonly routes: ReadonlyArray<EffectApiRoute>;
}

/**
 * The endpoint paths already include the group's `.prefix('/api')`.
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

export interface MountGroupOptions {
  readonly auth: Auth;
  readonly logger: Logger;
  /** `true` adds the shared schema-error layer; a layer adds a custom one. */
  readonly schemaErrors?: boolean | Layer.Layer<never, never, never>;
  /** Layers provided after the session and before the schema-error layer. */
  readonly extra?: MountLayers;
  /** Layers provided after the schema-error layer. */
  readonly afterSchema?: MountLayers;
}

type MountLayers =
  Layer.Layer<never, never, never> | ReadonlyArray<Layer.Layer<never, never, never>>;

type MountInput = Layer.Layer<never, never, unknown>;

type MountedLayer = Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | Layer.Success<typeof HttpServer.layerServices>
>;

function asLayers(
  layers: MountLayers | undefined,
): ReadonlyArray<Layer.Layer<never, never, never>> {
  if (layers === undefined) {
    return [];
  }
  return Array.isArray(layers) ? layers : [layers as Layer.Layer<never, never, never>];
}

function provideLayers(
  layer: MountInput,
  layers: ReadonlyArray<Layer.Layer<never, never, never>>,
): MountInput {
  return layers.reduce((current, next) => current.pipe(Layer.provide(next)), layer);
}

/**
 * The group, the session and the error layers every API module mounts, in the
 * order they used to be written by hand.
 */
export function mountGroups<Id extends string, Groups extends HttpApiGroup.Constraint, GroupIn>(
  api: HttpApi.HttpApi<Id, Groups>,
  groupLayer: Layer.Layer<HttpApiGroup.ToService<Id, Groups>, never, GroupIn>,
  options: MountGroupOptions,
): EffectApiMount {
  const apiLayer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(options.auth, options.logger)),
  );
  const schemaLayer =
    options.schemaErrors === true
      ? schemaErrorLayer(options.logger)
      : options.schemaErrors === false
        ? undefined
        : options.schemaErrors;
  const withExtras = provideLayers(apiLayer, asLayers(options.extra));
  const withSchema =
    schemaLayer === undefined ? withExtras : withExtras.pipe(Layer.provide(schemaLayer));
  const withAfter = provideLayers(withSchema, asLayers(options.afterSchema));
  // `Layer.provide` cannot reduce the api's remaining requirements while its
  // type is still generic; every caller passes fully built layers.
  return mountApi(api, withAfter as MountedLayer);
}

/**
 * Serves the API layer as a web handler and lists its routes from the API, so a
 * module keeps no hand-written array. The router logger stays off: it prints
 * full URLs, while the edge logs a redacted path.
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
