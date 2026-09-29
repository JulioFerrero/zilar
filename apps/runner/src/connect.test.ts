import { describe, expect, it } from 'vitest';
import { InMemoryKeyRegistry, generateRunnerKeypair, TunnelServer } from '@galena/runner-tunnel';
import { startFakeGateway } from '../../../packages/runner-tunnel/src/test-harness.ts';
import { runRunner } from './connect.ts';
import { buildIdentity } from './identity.ts';

function buildTestIdentity(machineId: string): ReturnType<typeof buildIdentity> {
  const keypair = generateRunnerKeypair();
  return buildIdentity({
    serverUrl: 'http://127.0.0.1:0',
    machineId,
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    name: 'test',
  });
}

describe('runRunner', () => {
  it('connects an approved key, then stops cleanly on signal', async () => {
    const gateway = await startFakeGateway();
    const registry = new InMemoryKeyRegistry();
    const identity = buildTestIdentity('runner-1');
    registry.approve(identity.machineId, identity.publicKey);
    const server = await TunnelServer.start({ registry, gatewayUrl: gateway.url }, 0);
    try {
      const controller = new AbortController();
      const done = runRunner({
        identity,
        hubUrl: server.wsUrl,
        signal: controller.signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.isRunnerLive(identity.machineId)).toBe(true);
      controller.abort();
      const result = await done;
      expect(result.status).toBe('stopped');
    } finally {
      await server.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });

  it('exits non-zero when the key is not approved', async () => {
    const gateway = await startFakeGateway();
    const registry = new InMemoryKeyRegistry();
    const identity = buildTestIdentity('runner-unknown');
    const server = await TunnelServer.start({ registry, gatewayUrl: gateway.url }, 0);
    try {
      const result = await runRunner({
        identity,
        hubUrl: server.wsUrl,
      });
      expect(['auth_failed', 'version_mismatch']).toContain(result.status);
      expect(result.message).toContain('refused');
      expect(server.isRunnerLive(identity.machineId)).toBe(false);
    } finally {
      await server.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });

  it('returns revoked when the server closes with revoke code', async () => {
    const gateway = await startFakeGateway();
    const registry = new InMemoryKeyRegistry();
    const identity = buildTestIdentity('runner-revoked');
    registry.approve(identity.machineId, identity.publicKey);
    const server = await TunnelServer.start({ registry, gatewayUrl: gateway.url }, 0);
    try {
      const controller = new AbortController();
      const states: string[] = [];
      const done = runRunner({
        identity,
        hubUrl: server.wsUrl,
        signal: controller.signal,
        logger: (line) => states.push(line),
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.isRunnerLive(identity.machineId)).toBe(true);
      registry.revoke(identity.machineId);
      const result = await done;
      expect(result.status).toBe('revoked');
      expect(result.message).toMatch(/revoked/i);
      expect(states.some((s) => s.includes('disconnected'))).toBe(true);
      void controller;
    } finally {
      await server.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });

  it('rejects a non-ws hub URL', async () => {
    const identity = buildTestIdentity('runner-x');
    await expect(
      runRunner({ identity, hubUrl: 'http://example.com:3189/tunnel' }),
    ).rejects.toMatchObject({ code: 'invalid_hub' });
  });
});
