import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRunnerKeypair, RunnerClient, type RunnerKeypair } from '@zilar/runner-tunnel';
import { user } from '../auth/auth-schema';
import type { ServerDatabase } from '../db/client';
import { machines } from '../db/schema';
import { createTestContext, type TestContext } from '../test-support';
import {
  createHubKeyRegistry,
  startRunnerHub,
  type HubKeyRegistry,
  type HubLogger,
  type HubMachineLookup,
  type HubRegistrySource,
  type RunnerHub,
} from './hub';

// T-0607 (lead-approved, test-only): the refresh-loop recovery test below needs
// the first `listApprovedMachineKeys` call to reject and later calls to hit the
// real database. A partial module mock scoped to this file does that; the flag
// is off for every other test, so they still reach the real function.
const serviceMocks = vi.hoisted(() => ({ failNextKeyRead: false }));

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>();
  return {
    ...actual,
    listApprovedMachineKeys: async (db: ServerDatabase) => {
      if (serviceMocks.failNextKeyRead) {
        serviceMocks.failNextKeyRead = false;
        throw new Error('database read failed');
      }
      return actual.listApprovedMachineKeys(db);
    },
  };
});

function noopRegistry(): HubRegistrySource {
  return { onRevoke: () => () => undefined, onApprove: () => () => undefined };
}

function silentLogger(): HubLogger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

async function insertApprovedMachine(db: ServerDatabase, publicKey: string): Promise<string> {
  const ownerUserId = randomUUID();
  await db
    .insert(user)
    .values({ id: ownerUserId, name: 'Owner', email: `${ownerUserId}@example.com` });
  const id = randomUUID();
  await db.insert(machines).values({
    id,
    ownerUserId,
    name: 'test-machine',
    publicKey,
    capabilities: { os: 'macos' },
    status: 'approved',
  });
  return id;
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface RunnerHandle {
  stop: () => Promise<void>;
}

async function startRunner(options: {
  serverUrl: string;
  runnerId: string;
  keypair: RunnerKeypair;
}): Promise<RunnerHandle> {
  const runner = new RunnerClient({
    serverUrl: options.serverUrl,
    runnerId: options.runnerId,
    keypair: options.keypair,
    enableModelListener: false,
    handshakeTimeoutMs: 5_000,
    reconnectBaseMs: 50,
    reconnectMaxMs: 100,
  });
  await runner.start().catch(() => undefined);
  return { stop: () => runner.stop().catch(() => undefined) };
}

describe('hub background loops as Effect fibers', () => {
  let context: TestContext;
  const opened: HubKeyRegistry[] = [];
  const hubs: RunnerHub[] = [];
  const runners: RunnerHandle[] = [];

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    for (const runner of runners.splice(0)) {
      await runner.stop();
    }
    for (const hub of hubs.splice(0)) {
      await hub.close();
    }
    for (const cache of opened.splice(0)) {
      cache.close();
    }
    await context.close();
  });

  it('runs the first refresh after one interval, repeats, and close stops it', async () => {
    const first = await insertApprovedMachine(context.db, 'effect-key-1');
    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger: silentLogger(),
      refreshMs: 30,
      autoStartTimer: true,
    });
    opened.push(cache);

    // The old loop waited one interval before its first run; so does this one.
    expect(cache.getPublicKey(first)).toBeNull();
    await waitFor(() => cache.getPublicKey(first) === 'effect-key-1', 2_000, 'first refresh');

    // The loop keeps repeating: an approval made after the first run shows up
    // on a later run.
    const second = await insertApprovedMachine(context.db, 'effect-key-2');
    await waitFor(() => cache.getPublicKey(second) === 'effect-key-2', 2_000, 'second refresh');

    // After close the fiber is interrupted: a revoked row is never read again,
    // so the cache keeps the key and no revoke listener fires.
    cache.close();
    let revoked = false;
    cache.onRevoke(() => {
      revoked = true;
    });
    await context.db
      .update(machines)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(machines.id, first));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(revoked).toBe(false);
    expect(cache.getPublicKey(first)).toBe('effect-key-1');
  });

  it('survives an unexpected throw from the refresh loop and keeps running', async () => {
    const id = await insertApprovedMachine(context.db, 'effect-key-survives');

    const messages: string[] = [];
    let internalThrew = false;
    const logger: HubLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: (_fields, message) => {
        messages.push(message);
        // A throw from inside `refresh`'s own catch (a broken logger, say)
        // rejects the refresh promise instead of being handled there.
        if (message === 'runner hub key refresh failed' && !internalThrew) {
          internalThrew = true;
          throw new Error('refresh logger failed');
        }
      },
    };

    // The first database read throws, the second succeeds, so the key only
    // appears if the loop caught the unexpected throw and resumed.
    serviceMocks.failNextKeyRead = true;

    const cache = createHubKeyRegistry({
      db: context.db,
      registry: noopRegistry(),
      logger,
      refreshMs: 30,
      autoStartTimer: true,
    });
    opened.push(cache);

    await waitFor(
      () => cache.getPublicKey(id) === 'effect-key-survives',
      2_000,
      'refresh loop recovered after an unexpected throw',
    );
    expect(messages).toContain('runner hub key refresh loop failed');
  });

  it('survives an unexpected throw from the last-seen poll and logs it', async () => {
    const key = generateRunnerKeypair();
    const id = await insertApprovedMachine(context.db, key.publicKey);

    // A registry whose last-seen write always fails, and a logger whose `warn`
    // throws the first time: `flushLastSeen` logs the failed write, the logger
    // itself throws, and that unexpected throw escapes `pollOnce`. The loop
    // must catch and log it instead of dying.
    const registry: HubMachineLookup = {
      onRevoke: () => () => undefined,
      onApprove: () => () => undefined,
      touchLastSeen: () => Promise.reject(new Error('touch failed')),
    };
    const errors: string[] = [];
    let warnThrew = false;
    const logger: HubLogger = {
      info: () => undefined,
      warn: () => {
        if (!warnThrew) {
          warnThrew = true;
          throw new Error('logger warn failed');
        }
      },
      error: (_fields, message) => {
        errors.push(message);
      },
    };

    const hub = await startRunnerHub({
      db: context.db,
      registry,
      logger,
      port: 0,
      gatewayUrl: 'http://127.0.0.1:65535',
      pollIntervalMs: 50,
    });
    hubs.push(hub);

    const runner = await startRunner({
      serverUrl: `ws://127.0.0.1:${hub.port}/tunnel`,
      runnerId: id,
      keypair: key,
    });
    runners.push(runner);

    await waitFor(
      () => errors.includes('runner hub last-seen poll failed'),
      5_000,
      'poll loop logged an unexpected throw',
    );
  });
});
