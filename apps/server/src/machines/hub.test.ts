import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  CLOSE_AUTH,
  CLOSE_REVOKED,
  generateRunnerKeypair,
  RunnerClient,
  type RunnerKeypair,
} from '@zilar/runner-tunnel';
import { createApp } from '../app';
import {
  bootstrapUser,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { createMachinesApi } from './api';
import {
  assertRunnerHubConfig,
  createHubKeyRegistry,
  HubConfigError,
  startRunnerHub,
  type HubLogger,
  type HubMachineLookup,
  type HubRegistrySource,
  type RunnerHub,
} from './hub';
import { createDbMachineRegistry } from './registry';

interface RunnerKey extends RunnerKeypair {}

function makeKey(): RunnerKey {
  return generateRunnerKeypair();
}

class FakeLogger implements HubLogger {
  readonly lines: Array<{
    level: 'info' | 'warn' | 'error';
    fields: Record<string, unknown>;
    message: string;
  }> = [];
  info(fields: Record<string, unknown>, message: string): void {
    this.lines.push({ level: 'info', fields, message });
  }
  warn(fields: Record<string, unknown>, message: string): void {
    this.lines.push({ level: 'warn', fields, message });
  }
  error(fields: Record<string, unknown>, message: string): void {
    this.lines.push({ level: 'error', fields, message });
  }
}

function makeLogger(): FakeLogger {
  return new FakeLogger();
}

// A no-op registry source: the key-cache tests never exercise route notifies,
// so a source that ignores listeners is the minimum the cache needs.
function noopRegistry(): HubRegistrySource {
  return {
    onRevoke: () => () => undefined,
    onApprove: () => () => undefined,
  };
}

async function insertMachine(
  source: Pick<TestContext, 'db'>,
  owner: string,
  overrides: { status?: 'pending' | 'approved' | 'revoked'; publicKey?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await testSql(source)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO machines (id, owner_user_id, name, public_key, capabilities, status)
        VALUES (${id}, ${owner}, ${'julio-mbp'}, ${overrides.publicKey ?? `public-key-for-${id}`}, ${JSON.stringify({ os: 'macos' })}::jsonb, ${overrides.status ?? 'approved'})`;
    }),
  );
  return id;
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createHubKeyRegistry', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('returns the key for an approved machine and null for everything else', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const user = await bootstrapUser(context, app, 'cache@example.com');
    const approved = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: 'approved-key',
    });
    const pending = await insertMachine(context, user.id, {
      status: 'pending',
      publicKey: 'pending-key',
    });
    const revoked = await insertMachine(context, user.id, {
      status: 'revoked',
      publicKey: 'revoked-key',
    });

    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger: makeLogger(),
    });
    await cache.refresh();

    expect(cache.getPublicKey(approved)).toBe('approved-key');
    expect(cache.getPublicKey(pending)).toBeNull();
    expect(cache.getPublicKey(revoked)).toBeNull();
    expect(cache.getPublicKey(randomUUID())).toBeNull();

    cache.close();
  });

  it('approve and revoke events take effect immediately and never touch the database', async () => {
    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger: makeLogger(),
    });
    await cache.refresh();
    const seen: string[] = [];
    cache.onRevoke((id) => {
      seen.push(id);
    });

    cache.approve('runner-x', 'key-x');
    expect(cache.getPublicKey('runner-x')).toBe('key-x');

    cache.revoke('runner-x');
    expect(cache.getPublicKey('runner-x')).toBeNull();
    expect(seen).toEqual(['runner-x']);

    // A revoke on a missing id is a no-op (no spurious listener fire).
    cache.revoke('runner-never-existed');
    expect(seen).toEqual(['runner-x']);

    cache.close();
  });

  it('refresh picks up approvals made elsewhere and drops revoked ones with listener fires', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const user = await bootstrapUser(context, app, 'refresh@example.com');
    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger: makeLogger(),
    });
    await cache.refresh();
    expect(cache.getPublicKey('ghost')).toBeNull();

    // An approval made elsewhere is visible after a refresh.
    const approved = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: 'fresh-key',
    });
    await cache.refresh();
    expect(cache.getPublicKey(approved)).toBe('fresh-key');

    // Revoking it (or it leaving the approved set) fires the revoke listener
    // and clears the key.
    const dropped: string[] = [];
    cache.onRevoke((id) => {
      dropped.push(id);
    });
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE machines SET status = 'revoked', revoked_at = ${new Date()} WHERE id = ${approved}`;
      }),
    );
    await cache.refresh();
    expect(cache.getPublicKey(approved)).toBeNull();
    expect(dropped).toEqual([approved]);

    cache.close();
  });

  it('a revoke that lands while a refresh is in flight is not undone by the stale read', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const user = await bootstrapUser(context, app, 'race@example.com');
    const registry = createDbMachineRegistry(context.db);
    const cache = createHubKeyRegistry({ db: context.db, registry, logger: makeLogger() });
    const id = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: 'raced-key',
    });

    // The query starts before the revoke event and reads the old, approved
    // row; the event arrives before the query resolves.
    const refreshing = cache.refresh();
    registry.notifyRevoked(id);
    await refreshing;

    expect(cache.getPublicKey(id)).toBeNull();
    cache.close();
  });

  it('keeps the old map when the database is broken, and the next good refresh still works', async () => {
    // A separate context we tear down ourselves: the afterEach also calls
    // close, which would throw because PGlite is already closed.
    const own = await createTestContext();
    try {
      const app = createApp({
        db: own.db,
        logger: own.logger,
        config: own.config,
        auth: own.auth,
        adminClient: own.adminClient,
      });
      const user = await bootstrapUser(own, app, 'broken@example.com');
      const id = await insertMachine(own, user.id, {
        status: 'approved',
        publicKey: 'still-here',
      });
      const logger = makeLogger();
      const cache = createHubKeyRegistry({ db: own.db, registry: noopRegistry(), logger });
      await cache.refresh();
      expect(cache.getPublicKey(id)).toBe('still-here');

      // Break the DB by closing it; the next refresh rejects, the cache
      // keeps the old map, `getPublicKey` still returns the old key, and
      // the error is logged with no key material.
      await own.client.close();
      await cache.refresh();
      expect(cache.getPublicKey(id)).toBe('still-here');
      expect(
        logger.lines.some((line) => line.level === 'error' && /refresh/i.test(line.message)),
      ).toBe(true);
      cache.close();
    } finally {
      // PGlite was already closed; swallow the error so afterEach still
      // gets a clean signal.
      await own.client.close().catch(() => undefined);
    }
  });

  it('close stops the refresh timer so it does not leak between tests', async () => {
    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger: makeLogger(),
      refreshMs: 50,
      autoStartTimer: true,
    });
    cache.close();
    // Nothing to assert directly; vitest will fail this test if any timer
    // keeps the process alive. The autoStartTimer stays false by default
    // for the other tests, so they too leave no timers behind.
  });
});

describe('assertRunnerHubConfig', () => {
  it('passes when the hub is disabled, whatever the gateway URL', () => {
    expect(() =>
      assertRunnerHubConfig({ enabled: false, gatewayUrl: 'https://example.com' }),
    ).not.toThrow();
    expect(() => assertRunnerHubConfig({ enabled: false, gatewayUrl: 'not-a-url' })).not.toThrow();
  });

  it('passes when the hub is on and the gateway is http://', () => {
    expect(() =>
      assertRunnerHubConfig({ enabled: true, gatewayUrl: 'http://127.0.0.1:4000' }),
    ).not.toThrow();
  });

  it('throws a named HubConfigError when the hub is on with a non-http gateway', () => {
    expect(() =>
      assertRunnerHubConfig({ enabled: true, gatewayUrl: 'https://example.com' }),
    ).toThrow(HubConfigError);
    expect(() =>
      assertRunnerHubConfig({ enabled: true, gatewayUrl: 'https://example.com' }),
    ).toThrow(/http:\/\//);
  });

  it('redacts the host of an https URL in the error message', () => {
    try {
      assertRunnerHubConfig({ enabled: true, gatewayUrl: 'https://secret.example.com:8443/x' });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HubConfigError);
      const message = (error as Error).message;
      expect(message).not.toContain('secret.example.com');
      expect(message).not.toContain('8443');
      expect(message).toContain('<redacted>');
    }
  });
});

interface RunnerHandle {
  runner: RunnerClient;
  connected: () => boolean;
  lastError: () => Error | null;
  stop: () => Promise<void>;
}

async function startRunner(options: {
  serverUrl: string;
  runnerId: string;
  keypair: RunnerKeypair;
  handshakeTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}): Promise<RunnerHandle> {
  const runner = new RunnerClient({
    serverUrl: options.serverUrl,
    runnerId: options.runnerId,
    keypair: options.keypair,
    enableModelListener: false,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 5_000,
    reconnectBaseMs: options.reconnectBaseMs ?? 50,
    reconnectMaxMs: options.reconnectMaxMs ?? 100,
  });
  let lastError: Error | null = null;
  runner.on('failed', (err?: Error) => {
    lastError = err ?? new Error('runner failed');
  });
  // The runner rejects with a fatal-close error; we catch so a rethrown
  // error doesn't bubble out of the test (we check state via `connected`).
  await runner.start().catch(() => undefined);
  return {
    runner,
    connected: () => runner.connected,
    lastError: () => lastError,
    stop: async () => {
      await runner.stop().catch(() => undefined);
    },
  };
}

describe('startRunnerHub', () => {
  let context: TestContext;
  let appInstance: ReturnType<typeof createApp>;
  let user: { id: string; cookie: string; bearer: string };
  let registry: ReturnType<typeof createDbMachineRegistry>;
  let hubRegistry: HubMachineLookup;
  const openedHubs: RunnerHub[] = [];
  const openedRunners: RunnerHandle[] = [];

  beforeEach(async () => {
    context = await createTestContext();
    registry = createDbMachineRegistry(context.db);
    appInstance = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      machineRegistry: registry,
    });
    user = await bootstrapUser(context, appInstance, 'hub@example.com');
    hubRegistry = registry;
  });

  afterEach(async () => {
    for (const runner of openedRunners.splice(0)) {
      await runner.stop();
    }
    for (const opened of openedHubs.splice(0)) {
      await opened.close();
    }
    await context.close();
  });

  function trackHub(h: RunnerHub): RunnerHub {
    openedHubs.push(h);
    return h;
  }

  function trackRunner(r: RunnerHandle): RunnerHandle {
    openedRunners.push(r);
    return r;
  }

  async function newHub(): Promise<RunnerHub> {
    const h = await startRunnerHub({
      db: context.db,
      registry: hubRegistry,
      logger: makeLogger(),
      port: 0,
      gatewayUrl: 'http://127.0.0.1:65535',
      refreshMs: 60_000,
      pollIntervalMs: 50,
    });
    return trackHub(h);
  }

  async function approveViaRoute(machineId: string, cookie: string): Promise<Response> {
    return appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
      method: 'POST',
      headers: { cookie },
    });
  }

  async function revokeViaRoute(machineId: string, cookie: string): Promise<Response> {
    return appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/revoke`, {
      method: 'POST',
      headers: { cookie },
    });
  }

  it('authenticates an approved machine, writes last_seen_at, and reports isOnline', async () => {
    const key = makeKey();
    const id = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: key.publicKey,
    });
    const hub = await newHub();

    const runner = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: key,
      }),
    );

    // The hub polls every `pollIntervalMs` (50 ms in tests) and updates
    // `isOnline` and `last_seen_at` on the first hit.
    await waitFor(() => hub.isOnline(id), 5_000, 'hub reports online');
    expect(runner.connected()).toBe(true);
    await waitFor(
      async () => {
        const [row] = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              lastSeenAt: Date | null;
            }>`SELECT last_seen_at FROM machines WHERE id = ${id}`;
          }),
        );
        return row?.lastSeenAt !== null;
      },
      5_000,
      'last_seen_at written',
    );
  });

  it('rejects a pending machine, even with the right key', async () => {
    const key = makeKey();
    const id = await insertMachine(context, user.id, {
      status: 'pending',
      publicKey: key.publicKey,
    });
    const hub = await newHub();
    const runner = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: key,
      }),
    );
    // The handshake should have failed with CLOSE_AUTH (4403). The runner
    // is a fatal close so it stops; the tunnel's `live` map stays empty.
    const err = runner.lastError();
    expect(err?.message ?? '').toContain(`(${CLOSE_AUTH})`);
    expect(runner.connected()).toBe(false);
    expect(hub.isOnline(id)).toBe(false);
  });

  it('rejects a runner signing with the wrong key', async () => {
    const rightKey = makeKey();
    const wrongKey = makeKey();
    const id = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: rightKey.publicKey,
    });
    const hub = await newHub();
    const runner = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: wrongKey,
      }),
    );
    const err = runner.lastError();
    expect(err?.message ?? '').toContain(`(${CLOSE_AUTH})`);
    expect(runner.connected()).toBe(false);
    expect(hub.isOnline(id)).toBe(false);
  });

  it('revoking through the route closes the live connection with CLOSE_REVOKED and prevents reconnect', async () => {
    const key = makeKey();
    const id = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: key.publicKey,
    });
    const hub = await newHub();
    const runner = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: key,
      }),
    );
    // Wait for the hub to consider the runner live (poll picks it up).
    await waitFor(() => hub.isOnline(id), 5_000, 'hub reports online');

    const response = await revokeViaRoute(id, user.cookie);
    expect(response.status).toBe(200);

    // The runner sees CLOSE_REVOKED on its end; with the fast reconnect
    // settings (50 ms base, 100 ms max), the retry would land within a
    // second. The 5 s timeout proves the retry is rejected, not just slow.
    await waitFor(
      () => (runner.lastError()?.message ?? '').includes(`(${CLOSE_REVOKED})`),
      5_000,
      'runner saw CLOSE_REVOKED',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hub.isOnline(id)).toBe(false);

    // A reconnect attempt must fail with the auth close: the key is gone
    // from the cache.
    const second = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: key,
      }),
    );
    const err = second.lastError();
    expect(err?.message ?? '').toContain(`(${CLOSE_AUTH})`);
  });

  it('approving a pending machine through the route lets it connect without waiting for the refresh', async () => {
    const key = makeKey();
    const id = await insertMachine(context, user.id, {
      status: 'pending',
      publicKey: key.publicKey,
    });
    const hub = await newHub();

    // Approve via the route; the registry must notify the hub synchronously.
    const response = await approveViaRoute(id, user.cookie);
    expect(response.status).toBe(200);

    const runner = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: id,
        keypair: key,
      }),
    );
    // The runner authenticates; if the notifyApproved path was broken we
    // would see CLOSE_AUTH on the failed event instead.
    expect(runner.lastError()).toBeNull();
    expect(runner.connected()).toBe(true);
    await waitFor(() => hub.isOnline(id), 5_000, 'hub reports online');
  });

  it('keeps two machines independent (one revoked does not drop the other)', async () => {
    const keyA = makeKey();
    const keyB = makeKey();
    const idA = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: keyA.publicKey,
    });
    const idB = await insertMachine(context, user.id, {
      status: 'approved',
      publicKey: keyB.publicKey,
    });
    const hub = await newHub();

    const runnerA = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: idA,
        keypair: keyA,
      }),
    );
    const runnerB = trackRunner(
      await startRunner({
        serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
        runnerId: idB,
        keypair: keyB,
      }),
    );

    await waitFor(() => hub.isOnline(idA) && hub.isOnline(idB), 5_000, 'both online');

    const revokeA = await revokeViaRoute(idA, user.cookie);
    expect(revokeA.status).toBe(200);

    await waitFor(
      () => (runnerA.lastError()?.message ?? '').includes(`(${CLOSE_REVOKED})`),
      5_000,
      'runner A saw CLOSE_REVOKED',
    );
    // Give B's runner a moment to react to anything; it must stay connected.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runnerB.connected()).toBe(true);
    expect(hub.isOnline(idA)).toBe(false);
    expect(hub.isOnline(idB)).toBe(true);
  });

  it('refuses to start with a non-http gateway URL', async () => {
    await expect(
      startRunnerHub({
        db: context.db,
        registry: hubRegistry,
        logger: makeLogger(),
        port: 0,
        gatewayUrl: 'https://example.com',
      }),
    ).rejects.toBeInstanceOf(HubConfigError);
  });
});

describe('machines routes with the hub', () => {
  let context: TestContext;
  let appInstance: ReturnType<typeof createApp>;
  let user: { id: string; cookie: string; bearer: string };

  beforeEach(async () => {
    context = await createTestContext();
    appInstance = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    user = await bootstrapUser(context, appInstance, 'online@example.com');
  });

  afterEach(async () => {
    await context.close();
  });

  it('reports online=true only for ids the hub says are online', async () => {
    const idA = await insertMachine(context, user.id, { status: 'approved', publicKey: 'a' });
    const idB = await insertMachine(context, user.id, { status: 'approved', publicKey: 'b' });
    const pending = await insertMachine(context, user.id, { status: 'pending', publicKey: 'p' });
    const revoked = await insertMachine(context, user.id, { status: 'revoked', publicKey: 'r' });
    const realOnline = new Set([idA]);
    const isMachineOnline = (id: string): boolean => realOnline.has(id);

    const response = await createMachinesApi({
      auth: context.auth,
      db: context.db,
      logger: context.logger,
      isMachineOnline,
    }).handler(
      new Request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: user.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    const byId = new Map(body.map((row) => [row['id'] as string, row]));
    expect(byId.get(idA)?.['online']).toBe(true);
    expect(byId.get(idB)?.['online']).toBe(false);
    expect(byId.get(pending)?.['online']).toBe(false);
    expect(byId.get(revoked)?.['online']).toBe(false);
  });

  it('reports online=false for every machine when the hub is off (no isMachineOnline injected)', async () => {
    const id = await insertMachine(context, user.id, { status: 'approved', publicKey: 'a' });
    const response = await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
      headers: { cookie: user.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]?.['online']).toBe(false);
    expect(body[0]?.['id']).toBe(id);
  });
});
