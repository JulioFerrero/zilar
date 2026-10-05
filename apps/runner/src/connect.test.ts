import { describe, expect, it } from 'vitest';
import {
  CLOSE_MALFORMED,
  CLOSE_UNKNOWN_TYPE,
  InMemoryKeyRegistry,
  generateRunnerKeypair,
  TunnelServer,
} from '@zilar/runner-tunnel';
import { startFakeGateway, waitFor } from '../../../packages/runner-tunnel/src/test-harness.ts';
import { mapFailure, hubUrlFromServer, runRunner, validateHubUrl } from './connect.ts';
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
      await waitFor(() => server.isRunnerLive(identity.machineId), 5_000, 'runner live');
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
      await waitFor(() => server.isRunnerLive(identity.machineId), 5_000, 'runner live');
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

describe('hubUrlFromServer', () => {
  it('maps http:// to ws:// on the given hub port', () => {
    expect(hubUrlFromServer('http://zilar.example.com', 3189)).toBe(
      'ws://zilar.example.com:3189/tunnel',
    );
  });

  it('maps https:// to wss:// on the given hub port', () => {
    expect(hubUrlFromServer('https://zilar.example.com', 3189)).toBe(
      'wss://zilar.example.com:3189/tunnel',
    );
    expect(hubUrlFromServer('https://zilar.example.com:3000', 3189)).toBe(
      'wss://zilar.example.com:3189/tunnel',
    );
  });
});

describe('validateHubUrl', () => {
  it('accepts ws:// and wss:// URLs', () => {
    expect(validateHubUrl('ws://127.0.0.1:3189/tunnel').toString()).toBe(
      'ws://127.0.0.1:3189/tunnel',
    );
    expect(validateHubUrl('wss://zilar.example.com:3189/tunnel').toString()).toBe(
      'wss://zilar.example.com:3189/tunnel',
    );
  });
});

describe('mapFailure', () => {
  it('maps a revoke close to status revoked', () => {
    expect(mapFailure('connection closed (4404): rejected by the server')).toEqual({
      status: 'revoked',
      message: 'this machine was revoked, run pair again with a new code',
    });
  });

  it('maps an auth close to status auth_failed', () => {
    expect(mapFailure('connection closed (4403): rejected by the server')).toEqual({
      status: 'auth_failed',
      message: 'the server refused our identity (auth failure)',
    });
  });

  it('maps a version close to status version_mismatch', () => {
    expect(mapFailure('connection closed (4402): rejected by the server')).toEqual({
      status: 'version_mismatch',
      message: 'the server speaks a different protocol version',
    });
  });

  it('maps a malformed-frame close to status disconnected (never auth_failed)', () => {
    const result = mapFailure(`connection closed (${CLOSE_MALFORMED}): rejected by the server`);
    expect(result.status).toBe('disconnected');
    expect(result.message).toMatch(/lost the connection/i);
    expect(result.message).not.toMatch(/auth/i);
  });

  it('maps an unknown-type close to status disconnected (never auth_failed)', () => {
    const result = mapFailure(`connection closed (${CLOSE_UNKNOWN_TYPE}): rejected by the server`);
    expect(result.status).toBe('disconnected');
    expect(result.message).toMatch(/lost the connection/i);
    expect(result.message).not.toMatch(/auth/i);
  });

  it('maps an unrecognised close to status disconnected (never auth_failed)', () => {
    const result = mapFailure('connection closed (1006): no reason');
    expect(result.status).toBe('disconnected');
    expect(result.message).toMatch(/lost the connection/i);
  });
});
