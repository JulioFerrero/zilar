import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_REVOKED,
  CLOSE_UNKNOWN_TYPE,
  CLOSE_VERSION,
  PROTOCOL_VERSION,
  encodeBinaryFrame,
  FRAME_DATA,
} from './protocol.ts';
import { InMemoryKeyRegistry, generateRunnerKeypair, signNonce } from './keys.ts';
import { RunnerClient } from './runner.ts';
import { TunnelServer } from './server.ts';
import {
  closeTunnelPair,
  rawHandshake,
  startFakeGateway,
  startTunnelPair,
  waitFor,
  wsCloseCode,
  type TunnelPair,
} from './test-harness.ts';

let pair: TunnelPair | null = null;

afterEach(async () => {
  if (pair !== null) {
    await closeTunnelPair(pair);
    pair = null;
  }
});

describe('runner identity over the wire', () => {
  it('connects an approved runner', async () => {
    pair = await startTunnelPair();
    expect(pair.runner.readyCount).toBe(1);
    expect(pair.server.isRunnerLive(pair.runnerId)).toBe(true);
  });

  it('refuses a runner whose key was never approved', async () => {
    const gateway = await startFakeGateway();
    const registry = new InMemoryKeyRegistry();
    const server = await TunnelServer.start({ registry, gatewayUrl: gateway.url }, 0);
    const runner = new RunnerClient({
      serverUrl: server.wsUrl,
      runnerId: 'stranger',
      keypair: generateRunnerKeypair(),
      exposedPorts: [],
    });
    try {
      await expect(runner.start()).rejects.toThrow(`(${CLOSE_AUTH})`);
      expect(runner.connected).toBe(false);
    } finally {
      await runner.stop().catch(() => undefined);
      await server.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });

  it('refuses a signature over a different nonce (replay)', async () => {
    pair = await startTunnelPair();
    const keypair = pair.keypair;
    // A real signature, but made for bytes the server never challenged.
    const raw = await rawHandshake(pair.server, pair.runnerId, () =>
      signNonce(keypair.privateKey, Buffer.from('stale-nonce-bytes')),
    );
    await waitFor(() => raw.closed, 5000, 'replay rejection');
    expect(raw.closeCode).toBe(CLOSE_AUTH);
    raw.destroy();
  });

  it('refuses a signature from an unknown key', async () => {
    pair = await startTunnelPair();
    const stranger = generateRunnerKeypair();
    const raw = await rawHandshake(pair.server, pair.runnerId, (nonce) =>
      signNonce(stranger.privateKey, nonce),
    );
    await waitFor(() => raw.closed, 5000, 'wrong-key rejection');
    expect(raw.closeCode).toBe(CLOSE_AUTH);
    raw.destroy();
  });

  it('revoking a key closes its live connection', async () => {
    pair = await startTunnelPair();
    const current = pair;
    const failed = new Promise<Error>((resolve) => {
      current.runner.on('failed', (err?: Error) => {
        resolve(err ?? new Error('no error'));
      });
    });
    pair.registry.revoke(pair.runnerId);
    const err = await failed;
    expect(err.message).toContain(`(${CLOSE_REVOKED})`);
    expect(pair.runner.connected).toBe(false);
    // The runner sees the close first; the server processes its own close
    // event a tick later, so wait for the live entry to go away.
    await waitFor(
      () => !current.server.isRunnerLive(current.runnerId),
      5000,
      'revoked runner gone',
    );
  });

  it('closes a malformed frame cleanly without throwing', async () => {
    pair = await startTunnelPair();
    const { code } = await wsCloseCode(pair.server, (ws: WebSocket) => {
      ws.send('this is not json');
    });
    expect(code).toBe(CLOSE_MALFORMED);
  });

  it('closes an unknown message type cleanly', async () => {
    pair = await startTunnelPair();
    const { code } = await wsCloseCode(pair.server, (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: 'desk.teleport', where: 'moon' }));
    });
    expect(code).toBe(CLOSE_UNKNOWN_TYPE);
  });

  it('rejects an old protocol version', async () => {
    pair = await startTunnelPair();
    const raw = await rawHandshake(pair.server, pair.runnerId, () => 'eA==', PROTOCOL_VERSION - 1);
    await waitFor(() => raw.closed, 5000, 'version rejection');
    expect(raw.closeCode).toBe(CLOSE_VERSION);
    raw.destroy();
  });

  it('drops a binary frame for an unknown stream and counts it, without dying', async () => {
    pair = await startTunnelPair();
    const keypair = generateRunnerKeypair();
    pair.registry.approve('raw-2', keypair.publicKey);
    const raw = await rawHandshake(pair.server, 'raw-2', (nonce) =>
      signNonce(keypair.privateKey, nonce),
    );
    await waitFor(() => raw.texts.length > 1 || raw.closed, 5000, 'ready');
    expect(raw.closed).toBe(false);
    const before = pair.server.unknownStreamsDropped;
    raw.sendBinary(encodeBinaryFrame(0xff_ff_ff_ff, FRAME_DATA, Buffer.from('orphan')));
    raw.sendText(JSON.stringify({ type: 'heartbeat', at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(raw.closed).toBe(false);
    expect((pair?.server.unknownStreamsDropped ?? 0) - before).toBeGreaterThanOrEqual(1);
    raw.destroy();
  });
});
