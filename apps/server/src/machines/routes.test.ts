import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createAuditRecorder, type AuditRecorder } from '../audit/service';
import { SOCKET_ADDRESS_HEADER } from '../effect/http';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  testSql,
  type TestContext,
} from '../test-support';
import {
  createMachinesApi,
  PAIR_RATE_LIMIT_WINDOW_MS,
  PAIRING_CODE_RATE_LIMIT_WINDOW_MS,
} from './api';
import { hashPairingCode, normalizePairingCode } from './codes';
import { createDbMachineRegistry, type DbMachineRegistry } from './registry';

type TestApp = ReturnType<typeof createApp>;

interface Requestable {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

interface RunnerKey {
  publicKey: string;
  privateKey: string;
}

function generateKey(): RunnerKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

function signCode(privateKeyBase64: string, code: string): string {
  const normalized = normalizePairingCode(code);
  if (normalized === null) {
    throw new Error('test signed an invalid code');
  }
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(`zilar-pair:v1:${normalized}`, 'ascii'), key).toString('base64');
}

function capabilities(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    os: 'macos',
    os_version: '27.0',
    arch: 'arm64',
    cpu: 'Apple M3 Pro',
    cores: 11,
    ram_gb: 18,
    disk_free_gb: 200,
    power: 'laptop',
    drivers: ['docker', 'apple-container'],
    tools: { xcode: true, browsers: ['chromium'] },
    labels: ['personal'],
    runner_version: '0.1.0',
    ...overrides,
  };
}

interface CodeHashRow {
  codeHash: string;
}

interface AuditRow {
  action: string;
  actorUserId: string | null;
  subjectId: string | null;
  detail: unknown;
}

interface AiMachineRow {
  machineId: string | null;
}

describe('machines routes', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function app(): TestApp {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
  }

  function mountMachines(
    overrides: {
      now?: () => number;
      getClientIp?: () => string;
      registry?: DbMachineRegistry;
      audit?: AuditRecorder;
    } = {},
  ): Requestable {
    const { getClientIp, ...deps } = overrides;
    const api = createMachinesApi({
      auth: context.auth,
      db: context.db,
      logger: context.logger,
      ...deps,
    });
    return {
      request(url: string, init: RequestInit = {}): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set(SOCKET_ADDRESS_HEADER, getClientIp?.() ?? 'unknown');
        return api.handler(new Request(url, { ...init, headers }));
      },
    };
  }

  async function newCode(
    appInstance: Requestable,
    cookie: string,
  ): Promise<{ code: string; expiresAt: string }> {
    const response = await appInstance.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { code: string; expiresAt: string };
  }

  async function pair(appInstance: Requestable, body: unknown): Promise<Response> {
    return await appInstance.request(`${TEST_BASE_URL}/api/runner/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function pairHappy(
    appInstance: Requestable,
    cookie: string,
    key: RunnerKey = generateKey(),
    name = 'julio-mbp',
    pairVia: Requestable = appInstance,
  ): Promise<{ code: string; machineId: string }> {
    const { code } = await newCode(appInstance, cookie);
    const response = await pair(pairVia, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name,
      capabilities: capabilities(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { machineId: string; status: string };
    expect(body.status).toBe('pending');
    return { code, machineId: body.machineId };
  }

  async function errorOf(response: Response): Promise<{ code: string; message: string }> {
    const body = (await response.json()) as { error: { code: string; message: string } };
    // Only code and message: the app also attaches a per-request requestId.
    return { code: body.error.code, message: body.error.message };
  }

  it('requires a signed-in user on every owner route, but not on the pair route', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `auth${testCounter}@example.com`);
    const { machineId } = await pairHappy(appInstance, user.cookie);

    const noAuth: Record<string, string> = {};
    expect((await appInstance.request(`${TEST_BASE_URL}/api/machines`)).status).toBe(401);
    expect(
      (
        await appInstance.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
          method: 'POST',
          headers: noAuth,
        })
      ).status,
    ).toBe(401);
    for (const [method, path, body] of [
      ['POST', `/api/machines/${machineId}/approve`, undefined],
      ['POST', `/api/machines/${machineId}/deny`, undefined],
      ['POST', `/api/machines/${machineId}/revoke`, undefined],
      ['PATCH', `/api/machines/${machineId}`, JSON.stringify({ name: 'x' })],
      ['DELETE', `/api/machines/${machineId}`, undefined],
    ] as const) {
      const response = await appInstance.request(`${TEST_BASE_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status).toBe(401);
    }
  });

  it('creates a pairing code shaped XXXX-XXXX, expiring in ten minutes', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `code${testCounter}@example.com`);
    const before = Date.now();

    const response = await appInstance.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; expiresAt: string };
    expect(body.code).toMatch(
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
    );

    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt - before).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
  });

  it('stores only the code hash, never the plain code', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `hash${testCounter}@example.com`);
    const { code } = await newCode(appInstance, user.cookie);

    const normalized = normalizePairingCode(code);
    expect(normalized).not.toBeNull();
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<CodeHashRow>`SELECT code_hash FROM machine_pairing_codes`;
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toBe(hashPairingCode(normalized ?? ''));
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(code);
    expect(dumped).not.toContain(normalized);
  });

  it('allows at most 5 unused codes, then 409 pairing_code_limit', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `codelimit${testCounter}@example.com`);

    for (let index = 0; index < 5; index += 1) {
      const response = await appInstance.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
        method: 'POST',
        headers: { cookie: user.cookie },
      });
      expect(response.status).toBe(201);
    }
    const sixth = await appInstance.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(sixth.status).toBe(409);
    expect((await errorOf(sixth)).code).toBe('pairing_code_limit');
  });

  it('rate-limits code creation to 10 per hour, resetting after the window', async () => {
    const setup = app();
    const user = await bootstrapUser(context, setup, `codelimited${testCounter}@example.com`);
    let now = Date.now();
    const limited = mountMachines({ now: () => now });

    async function createOnce() {
      return limited.request(`${TEST_BASE_URL}/api/machines/pairing-codes`, {
        method: 'POST',
        headers: { cookie: user.cookie },
      });
    }

    for (let index = 0; index < 5; index += 1) {
      expect((await createOnce()).status).toBe(201);
    }
    // Over the code quota but still inside the rate limit: 409, not 429.
    for (let index = 0; index < 5; index += 1) {
      const response = await createOnce();
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('pairing_code_limit');
    }
    const blocked = await createOnce();
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('rate_limited');

    now += PAIRING_CODE_RATE_LIMIT_WINDOW_MS + 1;
    // The limiter reset (not 429), and the five old codes expired after their
    // ten minutes, so creation succeeds again.
    const afterWindow = await createOnce();
    expect(afterWindow.status).toBe(201);
  });

  it('pairs a runner with a real ed25519 key and returns no owner identity', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `happy${testCounter}@example.com`);
    const key = generateKey();
    const { code } = await newCode(appInstance, user.cookie);

    const response = await pair(appInstance, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name: 'julio-mbp',
      capabilities: capabilities(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['machineId', 'status']);
    expect(body['status']).toBe('pending');
    expect(JSON.stringify(body)).not.toContain(user.id);
  });

  it('lists the owner machines with fingerprints and no key material', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `list${testCounter}@example.com`);
    const key = generateKey();
    const { machineId } = await pairHappy(appInstance, user.cookie, key);

    const listed = await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
      headers: { cookie: user.cookie },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    const expectedFingerprint = createHash('sha256')
      .update(Buffer.from(key.publicKey, 'base64'))
      .digest('hex')
      .slice(0, 16);
    expect(body[0]).toMatchObject({
      id: machineId,
      name: 'julio-mbp',
      status: 'pending',
      os: 'macos',
      osVersion: '27.0',
      arch: 'arm64',
      cpu: 'Apple M3 Pro',
      cores: 11,
      ramGb: 18,
      diskFreeGb: 200,
      drivers: ['docker', 'apple-container'],
      fingerprint: expectedFingerprint,
      approvedAt: null,
      lastSeenAt: null,
    });
    expect(Object.keys(body[0] ?? {}).sort()).toEqual(
      [
        'approvedAt',
        'arch',
        'cores',
        'cpu',
        'createdAt',
        'diskFreeGb',
        'drivers',
        'fingerprint',
        'id',
        'lastSeenAt',
        'name',
        'online',
        'os',
        'osVersion',
        'ramGb',
        'status',
      ].sort(),
    );
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain(key.publicKey);
    expect(dumped).not.toContain('code_hash');
  });

  it('returns an empty list when the owner has no machines', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `empty${testCounter}@example.com`);
    const listed = await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
      headers: { cookie: user.cookie },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);
  });

  it('approves a pending machine and rejects every other transition', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `approve${testCounter}@example.com`);
    const { machineId } = await pairHappy(appInstance, user.cookie);

    const approved = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${machineId}/approve`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as { status: string; approvedAt: string | null };
    expect(approvedBody.status).toBe('approved');
    expect(approvedBody.approvedAt).not.toBeNull();

    const again = await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('invalid_transition');

    const missing = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/does-not-exist/approve`,
      {
        method: 'POST',
        headers: { cookie: user.cookie },
      },
    );
    expect(missing.status).toBe(404);
  });

  it('denies a pending machine so it disappears, and refuses approved ones', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `deny${testCounter}@example.com`);
    const pending = await pairHappy(appInstance, user.cookie, generateKey(), 'pending-one');
    const approved = await pairHappy(appInstance, user.cookie, generateKey(), 'approved-one');
    await appInstance.request(`${TEST_BASE_URL}/api/machines/${approved.machineId}/approve`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });

    const denied = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${pending.machineId}/deny`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(denied.status).toBe(204);

    const listed = (await (
      await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: user.cookie },
      })
    ).json()) as Array<{ id: string }>;
    expect(listed.map((entry) => entry.id)).toEqual([approved.machineId]);

    const denyApproved = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${approved.machineId}/deny`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(denyApproved.status).toBe(409);
    expect((await errorOf(denyApproved)).code).toBe('invalid_transition');
  });

  it('revokes approved and pending machines, notifies listeners, and refuses revoked ones', async () => {
    const setup = app();
    const user = await bootstrapUser(context, setup, `revoke${testCounter}@example.com`);
    const registry = createDbMachineRegistry(context.db);
    const revokedIds: string[] = [];
    registry.onRevoke((machineId) => {
      revokedIds.push(machineId);
    });
    const mounted = mountMachines({ registry });

    const { machineId } = await pairHappy(setup, user.cookie);
    const revoked = await mounted.request(`${TEST_BASE_URL}/api/machines/${machineId}/revoke`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { status: string }).status).toBe('revoked');
    expect(revokedIds).toEqual([machineId]);

    const again = await mounted.request(`${TEST_BASE_URL}/api/machines/${machineId}/revoke`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('invalid_transition');

    const listed = (await (
      await mounted.request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: user.cookie },
      })
    ).json()) as Array<{ id: string; status: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('revoked');
  });

  it('renames a machine and rejects bad updates', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `rename${testCounter}@example.com`);
    const { machineId } = await pairHappy(appInstance, user.cookie);

    const renamed = await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'office-linux' }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { name: string }).name).toBe('office-linux');

    const empty = await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    });
    expect(empty.status).toBe(400);

    const extra = await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'office-linux', status: 'approved' }),
    });
    expect(extra.status).toBe(400);

    const missing = await appInstance.request(`${TEST_BASE_URL}/api/machines/does-not-exist`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'office-linux' }),
    });
    expect(missing.status).toBe(404);
  });

  it('deletes pending and revoked machines but never an approved one', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `delete${testCounter}@example.com`);
    const pending = await pairHappy(appInstance, user.cookie, generateKey(), 'pending-one');
    const approved = await pairHappy(appInstance, user.cookie, generateKey(), 'approved-one');
    await appInstance.request(`${TEST_BASE_URL}/api/machines/${approved.machineId}/approve`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });

    const deleteApproved = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${approved.machineId}`,
      { method: 'DELETE', headers: { cookie: user.cookie } },
    );
    expect(deleteApproved.status).toBe(409);
    expect((await errorOf(deleteApproved)).code).toBe('revoke_first');

    const deletePending = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${pending.machineId}`,
      { method: 'DELETE', headers: { cookie: user.cookie } },
    );
    expect(deletePending.status).toBe(204);

    await appInstance.request(`${TEST_BASE_URL}/api/machines/${approved.machineId}/revoke`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    const deleteRevoked = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${approved.machineId}`,
      { method: 'DELETE', headers: { cookie: user.cookie } },
    );
    expect(deleteRevoked.status).toBe(204);

    const listed = await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
      headers: { cookie: user.cookie },
    });
    expect(await listed.json()).toEqual([]);
  });

  it('answers 404 (not 403) for another user machines on every route', async () => {
    const appInstance = app();
    const alice = await bootstrapUser(context, appInstance, `alice${testCounter}@example.com`);
    const bob = await bootstrapUser(context, appInstance, `bob${testCounter}@example.com`);
    const { machineId } = await pairHappy(appInstance, alice.cookie);

    const bobList = (await (
      await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: bob.cookie },
      })
    ).json()) as unknown[];
    expect(bobList).toEqual([]);

    const attempts = await Promise.all([
      appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
        method: 'POST',
        headers: { cookie: bob.cookie },
      }),
      appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/deny`, {
        method: 'POST',
        headers: { cookie: bob.cookie },
      }),
      appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/revoke`, {
        method: 'POST',
        headers: { cookie: bob.cookie },
      }),
      appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}`, {
        method: 'PATCH',
        headers: { cookie: bob.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'stolen' }),
      }),
      appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}`, {
        method: 'DELETE',
        headers: { cookie: bob.cookie },
      }),
    ]);
    for (const response of attempts) {
      expect(response.status).toBe(404);
    }

    // Alice's machine is untouched.
    const aliceList = (await (
      await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: alice.cookie },
      })
    ).json()) as Array<{ name: string }>;
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]?.name).toBe('julio-mbp');
  });

  it('caps pending machines at 5 with 409 pending_limit', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `pendingcap${testCounter}@example.com`);
    for (let index = 0; index < 5; index += 1) {
      await pairHappy(appInstance, user.cookie, generateKey(), `machine-${index}`);
    }
    const { code } = await newCode(appInstance, user.cookie);
    const key = generateKey();
    const response = await pair(appInstance, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name: 'one-too-many',
      capabilities: capabilities(),
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('pending_limit');
  });

  it('caps machines at 20 per user with 409 machine_limit', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `machinecap${testCounter}@example.com`);
    // Pairing 20 machines needs 21 codes, but code creation allows 10 per
    // hour: advance the clock past each window, as a real owner would wait.
    let now = Date.now();
    let machineIp = 0;
    const host = mountMachines({
      now: () => now,
      getClientIp: () => {
        machineIp += 1;
        return `10.12.0.${machineIp}`;
      },
    });
    for (let index = 0; index < 20; index += 1) {
      if (index > 0 && index % 10 === 0) {
        now += PAIRING_CODE_RATE_LIMIT_WINDOW_MS + 1;
      }
      const { machineId } = await pairHappy(host, user.cookie, generateKey(), `m-${index}`, host);
      const approved = await host.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
        method: 'POST',
        headers: { cookie: user.cookie },
      });
      expect(approved.status).toBe(200);
    }
    now += PAIRING_CODE_RATE_LIMIT_WINDOW_MS + 1;
    const { code } = await newCode(host, user.cookie);
    const key = generateKey();
    const response = await pair(host, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name: 'one-too-many',
      capabilities: capabilities(),
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('machine_limit');
  });

  it('rejects expired, used, mismatched-signature and foreign-key pairs identically', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `failures${testCounter}@example.com`);
    // One fresh IP per attempt so the rate limiter never interferes with what
    // this test measures: every failure must be an identical 400.
    let attemptIp = 0;
    const pairHost = mountMachines({
      getClientIp: () => {
        attemptIp += 1;
        return `10.11.0.${attemptIp}`;
      },
    });
    const failures: Response[] = [];

    // Expired code with a valid signature.
    const expired = await newCode(appInstance, user.cookie);
    const expiredNormalized = normalizePairingCode(expired.code) ?? '';
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE machine_pairing_codes SET expires_at = ${new Date(Date.now() - 1000)} WHERE code_hash = ${hashPairingCode(expiredNormalized)}`;
      }),
    );
    const expiredKey = generateKey();
    failures.push(
      await pair(pairHost, {
        code: expired.code,
        publicKey: expiredKey.publicKey,
        signature: signCode(expiredKey.privateKey, expired.code),
        name: 'expired',
        capabilities: capabilities(),
      }),
    );

    // Used code: pair once, then again.
    const used = await newCode(appInstance, user.cookie);
    const usedKey = generateKey();
    const usedBody = {
      code: used.code,
      publicKey: usedKey.publicKey,
      signature: signCode(usedKey.privateKey, used.code),
      name: 'used',
      capabilities: capabilities(),
    };
    expect((await pair(pairHost, usedBody)).status).toBe(201);
    failures.push(await pair(pairHost, usedBody));

    // Valid code with a signature over another code.
    const codeA = await newCode(appInstance, user.cookie);
    const codeB = await newCode(appInstance, user.cookie);
    const confusedKey = generateKey();
    failures.push(
      await pair(pairHost, {
        code: codeA.code,
        publicKey: confusedKey.publicKey,
        signature: signCode(confusedKey.privateKey, codeB.code),
        name: 'confused',
        capabilities: capabilities(),
      }),
    );

    // Valid signature from a different key than the one sent.
    const codeC = await newCode(appInstance, user.cookie);
    const keyOne = generateKey();
    const keyTwo = generateKey();
    failures.push(
      await pair(pairHost, {
        code: codeC.code,
        publicKey: keyOne.publicKey,
        signature: signCode(keyTwo.privateKey, codeC.code),
        name: 'foreign',
        capabilities: capabilities(),
      }),
    );

    // Unknown code with garbage key material.
    failures.push(
      await pair(pairHost, {
        code: 'ZZZZ-ZZZZ',
        publicKey: 'not-a-key',
        signature: 'not-a-signature',
        name: 'garbage',
        capabilities: capabilities(),
      }),
    );

    // Malformed bodies.
    failures.push(await pair(pairHost, {}));
    failures.push(
      await pair(pairHost, {
        code: codeB.code,
        publicKey: keyOne.publicKey,
        signature: 'x',
        name: 'missing-capabilities',
      }),
    );
    failures.push(
      await pair(pairHost, {
        code: codeB.code,
        publicKey: keyOne.publicKey,
        signature: signCode(keyOne.privateKey, codeB.code),
        name: 'extra-field',
        capabilities: capabilities(),
        owner: 'mallory',
      }),
    );
    failures.push(
      await pair(pairHost, {
        code: '00000000',
        publicKey: keyOne.publicKey,
        signature: signCode(keyOne.privateKey, codeB.code),
        name: 'bad-code',
        capabilities: capabilities(),
      }),
    );
    failures.push(
      await pair(pairHost, {
        code: codeB.code,
        publicKey: keyOne.publicKey,
        signature: signCode(keyOne.privateKey, codeB.code),
        name: '',
        capabilities: capabilities(),
      }),
    );
    failures.push(
      await pair(pairHost, {
        code: codeB.code,
        publicKey: keyOne.publicKey,
        signature: signCode(keyOne.privateKey, codeB.code),
        name: 'bad-caps',
        capabilities: capabilities({ cores: -2 }),
      }),
    );

    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure.status).toBe(400);
    }
    const errors = await Promise.all(failures.map((failure) => errorOf(failure)));
    for (const error of errors) {
      expect(error).toEqual(errors[0]);
    }
    expect(errors[0]).toEqual({
      code: 'invalid_code',
      message: 'Invalid or expired pairing code',
    });
  });

  it('lets exactly one of two concurrent pairings with one code win', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `race${testCounter}@example.com`);
    const { code } = await newCode(appInstance, user.cookie);
    const keyA = generateKey();
    const keyB = generateKey();

    const [first, second] = await Promise.all([
      pair(appInstance, {
        code,
        publicKey: keyA.publicKey,
        signature: signCode(keyA.privateKey, code),
        name: 'racer-a',
        capabilities: capabilities(),
      }),
      pair(appInstance, {
        code,
        publicKey: keyB.publicKey,
        signature: signCode(keyB.privateKey, code),
        name: 'racer-b',
        capabilities: capabilities(),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);
    const loser = first.status === 400 ? first : second;
    expect(await errorOf(loser)).toEqual({
      code: 'invalid_code',
      message: 'Invalid or expired pairing code',
    });

    const listed = (await (
      await appInstance.request(`${TEST_BASE_URL}/api/machines`, {
        headers: { cookie: user.cookie },
      })
    ).json()) as unknown[];
    expect(listed).toHaveLength(1);
  });

  it('rejects a duplicate public key with 409 key_in_use', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `dupkey${testCounter}@example.com`);
    const key = generateKey();
    await pairHappy(appInstance, user.cookie, key, 'first');

    const { code } = await newCode(appInstance, user.cookie);
    const response = await pair(appInstance, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name: 'second',
      capabilities: capabilities(),
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('key_in_use');
  });

  it('never reuses a revoked key: revoke then re-pair fails with key_in_use', async () => {
    const appInstance = app();
    const user = await bootstrapUser(context, appInstance, `revokedkey${testCounter}@example.com`);
    const key = generateKey();
    const { machineId } = await pairHappy(appInstance, user.cookie, key, 'doomed');
    await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    await appInstance.request(`${TEST_BASE_URL}/api/machines/${machineId}/revoke`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });

    const { code } = await newCode(appInstance, user.cookie);
    const response = await pair(appInstance, {
      code,
      publicKey: key.publicKey,
      signature: signCode(key.privateKey, code),
      name: 'doomed-again',
      capabilities: capabilities(),
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('key_in_use');
  });

  it('rate-limits the pair route per IP and resets after the window', async () => {
    let now = Date.now();
    const limited = mountMachines({ now: () => now, getClientIp: () => '10.7.7.7' });

    async function badAttempt(): Promise<Response> {
      return limited.request(`${TEST_BASE_URL}/api/runner/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'AAAAAAAA',
          publicKey: 'garbage',
          signature: 'garbage',
          name: 'bot',
          capabilities: capabilities(),
        }),
      });
    }

    for (let index = 0; index < 10; index += 1) {
      const response = await badAttempt();
      expect(response.status).toBe(400);
    }
    const blocked = await badAttempt();
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('rate_limited');

    now += PAIR_RATE_LIMIT_WINDOW_MS + 1;
    expect((await badAttempt()).status).toBe(400);
  });

  it('rate-limits the pair route globally across all callers', async () => {
    let caller = 0;
    const mounted = mountMachines({
      getClientIp: () => {
        caller += 1;
        return `10.8.0.${caller}`;
      },
    });

    async function badAttempt(): Promise<Response> {
      return mounted.request(`${TEST_BASE_URL}/api/runner/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'AAAAAAAA',
          publicKey: 'garbage',
          signature: 'garbage',
          name: 'bot',
          capabilities: capabilities(),
        }),
      });
    }

    for (let index = 0; index < 30; index += 1) {
      expect((await badAttempt()).status).toBe(400);
    }
    const blocked = await badAttempt();
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('rate_limited');
  });

  it('writes one audit row per machine lifecycle event with no extra fields', async () => {
    const appInstance = app();
    const user = await bootstrapUser(
      context,
      appInstance,
      `machineaudit${testCounter}@example.com`,
    );
    const key = generateKey();
    const { code, machineId } = await pairHappy(appInstance, user.cookie, key, 'laptop-jp');
    void code;

    const approved = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${machineId}/approve`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(approved.status).toBe(200);

    const pendingMachineId = (
      await pairHappy(appInstance, user.cookie, generateKey(), 'laptop-pending')
    ).machineId;
    const denied = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${pendingMachineId}/deny`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(denied.status).toBe(204);

    const anotherPending = (
      await pairHappy(appInstance, user.cookie, generateKey(), 'laptop-revoke')
    ).machineId;
    const revoked = await appInstance.request(
      `${TEST_BASE_URL}/api/machines/${anotherPending}/revoke`,
      { method: 'POST', headers: { cookie: user.cookie } },
    );
    expect(revoked.status).toBe(200);

    const deletedMachineId = (
      await pairHappy(appInstance, user.cookie, generateKey(), 'laptop-deleted')
    ).machineId;
    const deleted = await appInstance.request(`${TEST_BASE_URL}/api/machines/${deletedMachineId}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(deleted.status).toBe(204);

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditRow>`SELECT action, actor_user_id, subject_id, detail FROM audit_log`;
      }),
    );
    const actions = rows.map((row) => row.action).sort();
    expect(actions).toEqual([
      'machine.approved',
      'machine.deleted',
      'machine.denied',
      'machine.paired',
      'machine.paired',
      'machine.paired',
      'machine.paired',
      'machine.revoked',
    ]);
    for (const row of rows) {
      expect(row.actorUserId).toBe(user.id);
      expect(row.subjectId).toHaveLength(36);
      expect(row.detail).toBeNull();
      const dumped = JSON.stringify(row);
      expect(dumped).not.toContain(key.publicKey);
      expect(dumped).not.toContain('laptop-');
    }
  });

  it('keeps answering when the recorder swallows a DB failure', async () => {
    // A closed PGlite makes every insert reject; the real recorder swallows.
    const broken = await createTestContext();
    await broken.client.close();
    const recorder = createAuditRecorder({
      db: broken.db,
      logger: { error: () => undefined },
    });
    const mounted = mountMachines({ audit: recorder });

    const user = await bootstrapUser(context, app(), `machineauditfail${testCounter}@example.com`);
    const { machineId } = await pairHappy(mounted, user.cookie, generateKey(), 'doomed');

    const approved = await mounted.request(`${TEST_BASE_URL}/api/machines/${machineId}/approve`, {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(approved.status).toBe(200);
    // The broken recorder caught every write: nothing landed in the real DB.
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditRow>`SELECT action, actor_user_id, subject_id, detail FROM audit_log`;
      }),
    );
    expect(rows).toHaveLength(0);
  });

  // T-0091: revoking or deleting a machine must null `ais.machineId` so the
  // UI never keeps a revoked or vanished machine as an AI's home. Both are
  // tested at the service layer with direct row writes: the routes above
  // already prove the public contract, and a direct insert keeps this
  // suite fast.
  it('revokeMachine clears machineId on AIs that point to it, in the same transaction', async () => {
    const { revokeMachine } = await import('./service');
    const alice = await bootstrapUser(context, app(), `revmachine${testCounter}@example.com`);
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${alice.id}, ${'openai'}, ${'irrelevant'}, ${null})`;
      }),
    );
    const targeted = randomUUID();
    const other = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO machines (id, owner_user_id, name, public_key, capabilities, status)
          VALUES (${targeted}, ${alice.id}, ${'julio-mbp'}, ${`pub-${targeted}`}, ${JSON.stringify({ os: 'macos' })}::jsonb, ${'approved'})`;
        yield* sql`INSERT INTO machines (id, owner_user_id, name, public_key, capabilities, status)
          VALUES (${other}, ${alice.id}, ${'office-linux'}, ${`pub-${other}`}, ${JSON.stringify({ os: 'linux' })}::jsonb, ${'approved'})`;
      }),
    );
    const aiAId = randomUUID();
    const aiBId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status, machine_id)
          VALUES (${aiAId}, ${alice.id}, ${'Dev-1'}, ${'dev'}, ${'p'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiAId}`}, ${`ai-${aiAId}@zilar.localhost`}, ${'active'}, ${targeted})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status, machine_id)
          VALUES (${aiBId}, ${alice.id}, ${'Dev-2'}, ${'dev'}, ${'p'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiBId}`}, ${`ai-${aiBId}@zilar.localhost`}, ${'active'}, ${other})`;
      }),
    );

    const updated = await revokeMachine(context.db, targeted, alice.id, new Date());
    expect(updated?.status).toBe('revoked');

    const [aiA] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiMachineRow>`SELECT machine_id FROM ais WHERE id = ${aiAId}`;
      }),
    );
    const [aiB] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiMachineRow>`SELECT machine_id FROM ais WHERE id = ${aiBId}`;
      }),
    );
    expect(aiA?.machineId).toBeNull();
    expect(aiB?.machineId).toBe(other);
  });

  it('deleting a machine row nulls machineId on the AIs that pointed at it', async () => {
    const alice = await bootstrapUser(context, app(), `delmachine${testCounter}@example.com`);
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${alice.id}, ${'openai'}, ${'irrelevant'}, ${null})`;
      }),
    );
    const machineId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO machines (id, owner_user_id, name, public_key, capabilities, status)
          VALUES (${machineId}, ${alice.id}, ${'julio-mbp'}, ${`pub-${machineId}`}, ${JSON.stringify({ os: 'macos' })}::jsonb, ${'revoked'})`;
      }),
    );
    const aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status, machine_id)
          VALUES (${aiId}, ${alice.id}, ${'Dev-1'}, ${'dev'}, ${'p'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@zilar.localhost`}, ${'active'}, ${machineId})`;
      }),
    );

    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM machines WHERE id = ${machineId}`;
      }),
    );
    const [aiRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiMachineRow>`SELECT machine_id FROM ais WHERE id = ${aiId}`;
      }),
    );
    expect(aiRow?.machineId).toBeNull();
  });
});
