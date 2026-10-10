import { once } from 'node:events';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_AUTH } from './protocol.ts';
import { InMemoryKeyRegistry, generateRunnerKeypair, signNonce } from './keys.ts';
import { TunnelServer } from './server.ts';
import { startFakeGateway, waitFor, wsCloseCode } from './test-harness.ts';

interface StartedServer {
  server: TunnelServer;
  registry: InMemoryKeyRegistry;
}

const servers: TunnelServer[] = [];
const gateways: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close().catch(() => undefined);
  }
  for (const gateway of gateways.splice(0)) {
    await gateway.close().catch(() => undefined);
  }
});

async function startServer(options: {
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  handshakeTimeoutMs?: number;
}): Promise<StartedServer> {
  const gateway = await startFakeGateway();
  gateways.push(gateway);
  const registry = new InMemoryKeyRegistry();
  const server = await TunnelServer.start({ registry, gatewayUrl: gateway.url, ...options }, 0);
  servers.push(server);
  return { server, registry };
}

function activeTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

describe('TunnelServer timers on Effect', () => {
  it('closes a connection that never sends hello with CLOSE_AUTH after the timeout', async () => {
    const { server } = await startServer({ handshakeTimeoutMs: 100 });
    const { code } = await wsCloseCode(server, () => {
      // Deliberately send nothing: the handshake deadline must fire.
    });
    expect(code).toBe(CLOSE_AUTH);
  });

  it('terminates a ready connection whose pongs stop after heartbeatTimeoutMs', async () => {
    const heartbeatIntervalMs = 20;
    const heartbeatTimeoutMs = 80;
    const { server, registry } = await startServer({
      heartbeatIntervalMs,
      heartbeatTimeoutMs,
      handshakeTimeoutMs: 10000,
    });
    const keypair = generateRunnerKeypair();
    registry.approve('raw-heartbeat', keypair.publicKey);
    // A ws client that never answers pings and counts them: the server sweeps
    // once per interval, so the number of pings it sends before it gives up is
    // a count of sweeps, which host load cannot stretch (a late sweep only
    // moves the whole schedule, and sweeps stay at least one interval apart).
    const ws = new WebSocket(server.wsUrl, { autoPong: false });
    const texts: string[] = [];
    let pings = 0;
    let closed = false;
    ws.on('ping', () => {
      pings += 1;
    });
    ws.on('close', () => {
      closed = true;
    });
    ws.on('message', (data) => {
      texts.push(String(data));
      if (texts.length === 1) {
        const challenge = JSON.parse(texts[0] as string) as { nonce?: string };
        ws.send(
          JSON.stringify({
            type: 'auth',
            signature: signNonce(keypair.privateKey, Buffer.from(challenge.nonce ?? '', 'base64')),
          }),
        );
      }
    });
    await once(ws, 'open');
    ws.send(
      JSON.stringify({
        type: 'hello',
        runner_id: 'raw-heartbeat',
        runner_version: '0.1.0',
        protocol_version: 1,
      }),
    );
    // The last pong the server can have counted is the moment it marks the
    // connection ready. Taking the mark before auth is sent is at or before
    // that instant, so observation lag can never shorten the measured interval.
    const started = Date.now();
    await waitFor(() => texts.length > 1, 5000, 'raw ready');
    await waitFor(() => closed, 5000, 'dead connection detection');
    const elapsed = Date.now() - started;
    // Terminated, and not before the timeout counted from the last pong...
    expect(elapsed).toBeGreaterThanOrEqual(heartbeatTimeoutMs - heartbeatIntervalMs);
    // ...and no later than the sweep after the timeout: every sweep before the
    // timeout pings, and sweeps stay at least one interval apart, so a window
    // of the timeout holds at most timeout / interval + 1 pings. Host load
    // moves the sweeps; it cannot pack more of them into the window. A stalled
    // event loop can push the first sweep past the timeout, so the count may be
    // zero, but the elapsed lower bound above still proves it did not end early.
    expect(pings).toBeLessThanOrEqual(heartbeatTimeoutMs / heartbeatIntervalMs + 1);
    ws.terminate();
  });

  it('interrupts every fiber on close so no timer keeps the process alive', async () => {
    const baseline = activeTimers();
    const { server } = await startServer({
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 50,
      handshakeTimeoutMs: 60000,
    });
    await server.close();
    // Idempotent, exactly as before the conversion.
    await expect(server.close()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeTimers()).toBeLessThanOrEqual(baseline);
  });
});
