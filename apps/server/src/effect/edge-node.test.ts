// B1.6 (T-0733): serve a `createEdge` through `serveEdgeOnNode` on an
// ephemeral port, the same helper `index.ts` uses. Checks the health route,
// HEAD-as-GET with an empty body, the real loopback socket address (not
// `'unknown'`), and that a streamed `ReadableStream` body reaches the client
// incrementally (the SSE drafts must not buffer).

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEdge } from './edge';
import { SOCKET_ADDRESS_HEADER, socketAddressOf } from './http-core';
import { serveEdgeOnNode, type ServedEdgeOnNode } from './node-serve';
import { createTestContext, type TestContext } from '../test-support';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function startNodeEdge(context: TestContext, seen: Array<string>) {
  const edge = createEdge({
    mounts: [
      {
        routes: [{ method: 'GET', path: '/api/probe' }],
        handler: (request: Request) => {
          const seenRequest = HttpServerRequest.fromWeb(request);
          const program = Effect.map(HttpServerRequest.HttpServerRequest, (serverRequest) =>
            socketAddressOf(serverRequest),
          );
          return Effect.runPromise(
            Effect.provideService(program, HttpServerRequest.HttpServerRequest, seenRequest),
          ).then((address) => {
            seen.push(address);
            return new Response('ok');
          });
        },
      },
      {
        routes: [{ method: 'GET', path: '/api/stream' }],
        handler: () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('a'));
              setTimeout(() => {
                controller.enqueue(encoder.encode('b'));
                controller.close();
              }, 100);
            },
          });
          return Promise.resolve(
            new Response(stream, { headers: { 'content-type': 'text/plain' } }),
          );
        },
      },
    ],
    auth: { handler: () => Promise.resolve(new Response('not found', { status: 404 })) },
    config: context.config,
    logger: context.logger,
    health: () => Promise.resolve({ status: 200, body: { ok: true } }),
  });
  // Keep the web handler's resources for the `fetch` callers; only `layer`
  // is served here, through the same helper `index.ts` uses.
  const served = await serveEdgeOnNode(edge, { port: 0 });
  return { edge, served, port: served.port };
}

describe('edge on NodeHttpServer (B1.6)', () => {
  let context: TestContext;
  let edge: ReturnType<typeof createEdge> | undefined;
  let served: ServedEdgeOnNode | undefined;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (served !== undefined) {
      await served.close();
      served = undefined;
    }
    if (edge !== undefined) {
      await edge.dispose();
      edge = undefined;
    }
    await context.close();
  });

  it('serves /health, HEAD-as-GET, and the real loopback address', async () => {
    const seen: Array<string> = [];
    const started = await startNodeEdge(context, seen);
    edge = started.edge;
    served = started.served;
    const base = `http://127.0.0.1:${started.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const head = await fetch(`${base}/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const probe = await fetch(`${base}/api/probe`);
    expect(probe.status).toBe(200);
    await probe.text();
    expect(seen).toHaveLength(1);
    expect(LOOPBACK.has(seen[0] ?? '')).toBe(true);
  });

  it('streams a ReadableStream body incrementally', async () => {
    const seen: Array<string> = [];
    const started = await startNodeEdge(context, seen);
    edge = started.edge;
    served = started.served;
    const base = `http://127.0.0.1:${started.port}`;

    const response = await fetch(`${base}/api/stream`);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).not.toBeUndefined();
    if (reader === undefined || reader === null) {
      throw new Error('expected a readable response body');
    }
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe('a');
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(decoder.decode(second.value)).toBe('b');
    await reader.cancel();
  });

  it('strips a client-forged socket-address header under Node', async () => {
    const seen: Array<string> = [];
    const started = await startNodeEdge(context, seen);
    edge = started.edge;
    served = started.served;
    const base = `http://127.0.0.1:${started.port}`;

    const probe = await fetch(`${base}/api/probe`, {
      headers: { [SOCKET_ADDRESS_HEADER]: '203.0.113.99' },
    });
    expect(probe.status).toBe(200);
    await probe.text();
    expect(seen).toHaveLength(1);
    expect(LOOPBACK.has(seen[0] ?? '')).toBe(true);
  });
});
