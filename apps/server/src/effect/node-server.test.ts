// B1.2 smoke test: prove the pinned `@effect/platform-node@4.0.2` serves one
// `HttpRouter` route on a Node server and that the Node adapter fills
// `remoteAddress` (B1.5 reads it). The app does not use this yet.

import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';

const PingRoute = HttpRouter.add(
  'GET',
  '/ping',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const remoteAddress = Option.getOrNull(request.remoteAddress);
    yield* Effect.logDebug('ping handled', { remoteAddress });
    return HttpServerResponse.jsonUnsafe({ ok: true, remoteAddress });
  }),
);

// `provideMerge` keeps the `HttpServer` service in the runtime context so the
// test can read the bound port from `address`.
const App = HttpRouter.serve(PingRoute, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })),
);

describe('NodeHttpServer smoke (B1.2)', () => {
  it('serves one HttpRouter route on a random port and reports a remote address', async () => {
    const runtime = ManagedRuntime.make(App);
    try {
      const port = await runtime.runPromise(
        Effect.gen(function* () {
          const server = yield* HttpServer.HttpServer;
          const address = server.address;
          if (address._tag === 'UnixPathAddress') {
            throw new Error('expected the smoke server to listen on a TCP port');
          }
          return address.port;
        }),
      );

      const response = await fetch(`http://127.0.0.1:${port}/ping`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { ok: boolean; remoteAddress: string | null };
      expect(body.ok).toBe(true);
      expect(typeof body.remoteAddress).toBe('string');
      expect(body.remoteAddress).not.toBe('');
    } finally {
      await runtime.dispose();
    }
  });
});
