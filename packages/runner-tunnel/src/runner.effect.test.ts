import { EventEmitter } from 'node:events';
import net from 'node:net';
import { Effect, type Fiber } from 'effect';
import type { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { generateRunnerKeypair } from './keys.ts';
import { RunnerClient } from './runner.ts';
import { closeTunnelPair, startTunnelPair, waitFor } from './test-harness.ts';

/** A free port with no listener, so a connect attempt fails instead of hanging. */
async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('no port');
  }
  const port = address.port;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

describe('RunnerClient lifecycle on Effect', () => {
  it('stop() during a backoff wait returns promptly', async () => {
    const port = await unusedPort();
    const runner = new RunnerClient({
      serverUrl: `ws://127.0.0.1:${port}/tunnel`,
      runnerId: 'runner-1',
      keypair: generateRunnerKeypair(),
      enableModelListener: false,
      reconnectBaseMs: 60000,
      reconnectMaxMs: 60000,
    });
    const started = runner.start();
    started.catch(() => undefined);
    await waitFor(() => runner.reconnectAttempts >= 1, 5000, 'first backoff wait');
    const startedAt = Date.now();
    await runner.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('a handshake timeout removes its listeners', async () => {
    const runner = new RunnerClient({
      serverUrl: 'ws://127.0.0.1:1/tunnel',
      runnerId: 'runner-1',
      keypair: generateRunnerKeypair(),
      enableModelListener: false,
      handshakeTimeoutMs: 300,
    });
    const emitter = new EventEmitter();
    const fakeWs = Object.assign(emitter, {
      close: (): void => undefined,
    }) as unknown as WebSocket;
    const internals = runner as unknown as {
      waitForType(ws: WebSocket, expected: 'challenge' | 'ready'): Effect.Effect<unknown, Error>;
    };
    const pending = Effect.runPromise(internals.waitForType(fakeWs, 'challenge'));
    pending.catch(() => undefined);
    // The three listeners are registered above the baseline while the handshake
    // waits for a frame...
    await waitFor(
      () =>
        emitter.listenerCount('message') === 1 &&
        emitter.listenerCount('close') === 1 &&
        emitter.listenerCount('error') === 1,
      250,
      'handshake listeners registered',
    );
    // ...and removed again when the timeout fires.
    await expect(pending).rejects.toThrow('timeout waiting for challenge');
    expect(emitter.listenerCount('message')).toBe(0);
    expect(emitter.listenerCount('close')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('the heartbeat stops after teardown', async () => {
    const pair = await startTunnelPair({ reconnectBaseMs: 60000, reconnectMaxMs: 60000 });
    try {
      const internals = pair.runner as unknown as {
        heartbeatFiber: Fiber.Fiber<unknown, unknown> | null;
      };
      const fiber = internals.heartbeatFiber;
      if (fiber === null) {
        throw new Error('no heartbeat fiber after connect');
      }
      expect(pair.server.disconnectRunner(pair.runnerId)).toBe(true);
      await waitFor(() => fiber.pollUnsafe() !== undefined, 5000, 'heartbeat fiber stopped');
      expect(internals.heartbeatFiber).toBeNull();
    } finally {
      await closeTunnelPair(pair);
    }
  });
});
