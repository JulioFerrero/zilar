import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@zilar/server/src/app.ts';
import {
  bootstrapUser,
  createTestContext,
  type TestContext,
} from '@zilar/server/src/test-support.ts';
import { startRunnerHub } from '@zilar/server/src/machines/hub.ts';
import { createDbMachineRegistry } from '@zilar/server/src/machines/registry.ts';
import { pairRunner } from './pair.ts';
import { runRunner } from './connect.ts';
import { identityPaths, type RunnerIdentity } from './identity.ts';

// `serve` from `@hono/node-server` lives inside `@zilar/server/node_modules`
// because the runner does not list it as a direct dependency. A dynamic
// import lets Node resolve it through the workspace symlink and keeps the
// runner's typecheck free of `@hono/node-server` types.
type ServeOptions = {
  fetch: (request: Request) => Promise<Response> | Response;
  port: number;
};
type ServeFn = (options: ServeOptions) => http.Server;
async function loadServe(): Promise<ServeFn> {
  const mod = (await import('@zilar/server/node_modules/@hono/node-server/dist/index.mjs')) as {
    serve: ServeFn;
  };
  return mod.serve;
}

interface E2EHandle {
  context: TestContext;
  httpServer: http.Server;
  httpPort: number;
  registry: ReturnType<typeof createDbMachineRegistry>;
  user: { id: string; cookie: string; bearer: string };
  homeDir: string;
  setHub: (hub: Awaited<ReturnType<typeof startRunnerHub>> | null) => void;
  isMachineOnline: (machineId: string) => boolean;
  cleanup: () => Promise<void>;
}

async function startE2E(): Promise<E2EHandle> {
  const context = await createTestContext();
  const registry = createDbMachineRegistry(context.db);
  let hub: Awaited<ReturnType<typeof startRunnerHub>> | null = null;
  const isMachineOnline = (machineId: string): boolean => {
    return hub?.isOnline(machineId) ?? false;
  };
  // Build a second app wired to the live `isMachineOnline` so the
  // /api/machines route reflects the hub state once it comes up. The auth
  // app (no hub) is only used to bootstrap the user.
  const appWithOnline = createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    machineRegistry: registry,
    isMachineOnline,
  });
  const serve = await loadServe();
  const httpServer = serve({ fetch: appWithOnline.fetch, port: 0 });
  const httpPort = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      const address = httpServer.address();
      if (address !== null && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('http server did not bind a port'));
      }
    });
  });
  const bootstrapApp = createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    machineRegistry: registry,
  });
  const user = await bootstrapUser(context, bootstrapApp, 'e2e@example.com');
  const homeDir = mkdtempSync(join(tmpdir(), 'zilar-runner-e2e-'));
  let closed = false;
  return {
    context,
    httpServer,
    httpPort,
    registry,
    user,
    homeDir,
    setHub(next) {
      hub = next;
    },
    isMachineOnline,
    cleanup: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      if (hub !== null) {
        await hub.close().catch(() => undefined);
        hub = null;
      }
      await context.close();
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('runner e2e (real server + real hub)', () => {
  let e2e: E2EHandle;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    e2e = await startE2E();
    cleanup = e2e.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('pairs, runs, sees online, revokes, and ends runRunner with revoked', async () => {
    const serverBase = `http://127.0.0.1:${e2e.httpPort}`;

    // Mint a pairing code through POST /api/machines/pairing-codes.
    const codeResponse = await fetch(`${serverBase}/api/machines/pairing-codes`, {
      method: 'POST',
      headers: { cookie: e2e.user.cookie },
    });
    expect(codeResponse.status).toBe(201);
    const { code } = (await codeResponse.json()) as { code: string; expiresAt: string };

    // Run pairRunner against the real HTTP listener.
    const pairResult = await pairRunner({
      code,
      serverUrl: serverBase,
      storage: identityPaths(e2e.homeDir),
      name: 'e2e-runner',
    });
    const machineId = pairResult.machineId;
    expect(machineId.length).toBeGreaterThan(0);

    // The machine is pending and offline.
    const initialList = await fetch(`${serverBase}/api/machines`, {
      headers: { cookie: e2e.user.cookie },
    });
    expect(initialList.status).toBe(200);
    const initialRows = (await initialList.json()) as Array<{
      id: string;
      status: string;
      online: boolean;
      fingerprint: string;
    }>;
    const pendingRow = initialRows.find((row) => row.id === machineId);
    expect(pendingRow?.status).toBe('pending');
    expect(pendingRow?.online).toBe(false);
    expect(pendingRow?.fingerprint).toBe(pairResult.fingerprint);

    // Start the runner hub on a random loopback port.
    const hub = await startRunnerHub({
      db: e2e.context.db,
      registry: e2e.registry,
      logger: e2e.context.logger,
      port: 0,
      gatewayUrl: 'http://127.0.0.1:65535',
      refreshMs: 60_000,
      pollIntervalMs: 50,
    });
    e2e.setHub(hub);

    // Approve through the route.
    const approveResponse = await fetch(`${serverBase}/api/machines/${machineId}/approve`, {
      method: 'POST',
      headers: { cookie: e2e.user.cookie },
    });
    expect(approveResponse.status).toBe(200);

    // Read the identity the pair step wrote to disk.
    const { loadIdentity } = await import('./identity.ts');
    const identity: RunnerIdentity = await loadIdentity(identityPaths(e2e.homeDir));

    // Run runRunner against the hub.
    const runnerDone = runRunner({
      identity,
      hubUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
    });

    // Wait until /api/machines reports online=true.
    await waitFor(
      async () => {
        const r = await fetch(`${serverBase}/api/machines`, {
          headers: { cookie: e2e.user.cookie },
        });
        const body = (await r.json()) as Array<{ id: string; online: boolean }>;
        return body.find((row) => row.id === machineId)?.online === true;
      },
      10_000,
      'machines route reports online=true',
    );

    // Revoke through the route.
    const revokeResponse = await fetch(`${serverBase}/api/machines/${machineId}/revoke`, {
      method: 'POST',
      headers: { cookie: e2e.user.cookie },
    });
    expect(revokeResponse.status).toBe(200);

    // runRunner resolves with revoked and a runtime-failure message.
    const result = await runnerDone;
    expect(result.status).toBe('revoked');
    expect(result.message.toLowerCase()).toContain('revoked');
  });
});
