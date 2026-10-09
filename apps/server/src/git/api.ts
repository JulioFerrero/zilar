// The git proxy on the Effect `HttpRouter` (T-0740): one catch-all route for
// every method under the path prefix. The proxy itself is a plain Web handler
// (`proxy.ts`); this file converts the request, forwards it and renders failures
// through the shared envelope.
//
// Not mounted in `app.ts`: the edge matcher has no wildcard routes
// (`effect/edge.ts:95-104`), so `routes` is empty and the handler is only
// driven by tests until a wildcard mount exists.

import { Effect, Layer } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import type { Logger } from 'pino';
import { requestIdOf, withErrorEnvelope, type EffectApiMount } from '../effect/http-core';
import { createGitProxy, DEFAULT_GIT_PATH_PREFIX, type GitProxyDependencies } from './proxy';

function isRoutePath(path: string): path is `/${string}` {
  return path.startsWith('/');
}

function gitRoutePath(pathPrefix: string): `/${string}` {
  const path = `${pathPrefix}/*`;
  if (!isRoutePath(path)) {
    throw new Error(`git path prefix must start with "/": ${pathPrefix}`);
  }
  return path;
}

export function createGitApi(deps: GitProxyDependencies & { logger: Logger }): EffectApiMount {
  const { logger } = deps;
  const proxy = createGitProxy(deps);
  const routePath = gitRoutePath(deps.pathPrefix ?? DEFAULT_GIT_PATH_PREFIX);

  const routeLayer = HttpRouter.add('*', routePath, (request) =>
    withErrorEnvelope(
      Effect.gen(function* () {
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const webResponse = yield* Effect.promise(() => proxy(webRequest));
        return HttpServerResponse.fromWeb(webResponse);
      }),
      logger,
      requestIdOf(request),
    ),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    routeLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: [] };
}
