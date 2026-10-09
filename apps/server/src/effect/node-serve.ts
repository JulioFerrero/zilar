// Shared Node starter for the Effect edge (T-0733, B1.6): serves a
// `ZilarEdge`'s `layer` on its own `node:http` server, so `index.ts` and
// tests share one start/stop path instead of reaching for an adapter.
// `NodeHttpServer` fills `HttpServerRequest.remoteAddress` from the real
// socket, so no `serve({ fetch })`-bindings workaround is needed.

import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { createServer, type Server } from 'node:http';
import type { ZilarEdge } from './edge';

export interface ServeEdgeOnNodeOptions {
  readonly port: number;
  /**
   * How long `close()` waits before dropping live connections (SSE draft
   * streams never end on their own). `index.ts` passes its
   * `CONNECTION_GRACE_MS`; tests use the default.
   */
  readonly connectionGraceMs?: number;
}

export interface ServedEdgeOnNode {
  readonly httpServer: Server;
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_CONNECTION_GRACE_MS = 3_000;

export async function serveEdgeOnNode(
  edge: Pick<ZilarEdge, 'layer'>,
  options: ServeEdgeOnNodeOptions,
): Promise<ServedEdgeOnNode> {
  const httpServer = createServer();
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(edge.layer, { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => httpServer, { port: options.port })),
    ),
  );
  const port = await runtime.runPromise(
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const address = server.address;
      if (address._tag === 'UnixPathAddress') {
        throw new Error('expected the edge server to listen on a TCP port');
      }
      return address.port;
    }),
  );
  const connectionGraceMs = options.connectionGraceMs ?? DEFAULT_CONNECTION_GRACE_MS;
  return {
    httpServer,
    port,
    close: async () => {
      // `close()` waits for every open connection, so drop idle ones at
      // once and live ones after the grace, then release the runtime.
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections();
        setTimeout(() => httpServer.closeAllConnections(), connectionGraceMs).unref();
      });
      await runtime.dispose();
    },
  };
}
