import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_AUTH } from './protocol.ts';
import { InMemoryKeyRegistry, generateRunnerKeypair, signNonce } from './keys.ts';
import { TunnelServer } from './server.ts';
import { rawHandshake, startFakeGateway, waitFor, wsCloseCode } from './test-harness.ts';

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
    const raw = await rawHandshake(server, 'raw-heartbeat', (nonce) =>
      signNonce(keypair.privateKey, nonce),
    );
    // This client never answers pings, so the last pong the server can have
    // counted is the moment it marks the connection ready. Taking the mark here
    // (right after auth is sent, before the server can reach ready) is at or
    // before that instant, so observation lag can never shorten the measured
    // interval.
    const started = Date.now();
    await waitFor(() => raw.texts.length > 1 || raw.closed, 5000, 'raw ready');
    expect(raw.closed).toBe(false);
    await waitFor(() => raw.closed, 5000, 'dead connection detection');
    const elapsed = Date.now() - started;
    // Terminated, and not before the timeout counted from the last pong...
    expect(elapsed).toBeGreaterThanOrEqual(heartbeatTimeoutMs - heartbeatIntervalMs);
    // ...nor much later than the timeout plus one sweep interval, plus slack.
    expect(elapsed).toBeLessThanOrEqual(heartbeatTimeoutMs + 2 * heartbeatIntervalMs + 50);
    raw.destroy();
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
