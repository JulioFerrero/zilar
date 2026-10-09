// First-run setup routes (T-0161): status, the setup transaction, the
// test-code send with rollback, the post-setup 404, and the rate limit.
// No test touches a real mail provider: the test-code send is injected.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { createAuditRecorder } from '../audit/service';
import { CurrentMailer, type Mailer } from '../auth/mailer';
import { createApp } from '../app';
import { auditLog, instanceSettings, invites, user } from '../db/schema';
import { sqlRuntimeFor, type SqlRuntime } from '../effect/sql';
import { createTestContext, TEST_BASE_URL, type TestContext } from '../test-support';
import { SETUP_API_ROUTES, SETUP_RATE_LIMIT_MAX, type SetupApiDependencies } from './api';
import {
  getMailSettings,
  MAIL_FROM_SETTING,
  needsSetup,
  RESEND_API_KEY_SETTING,
  settingsCipherFor,
} from './settings';

// Only `sqlRuntimeFor` is wrapped; every other export is the real module. A
// test can break the runtime for the next call; unqueued calls pass through
// (the T-0669 pattern).
vi.mock('../effect/sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../effect/sql')>();
  return { ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) };
});

const SENTINEL_KEY = 're_ZILAR_SETUP_SENTINEL_KEY_9f8e7d6c5b4a';
const SENTINEL_FROM = 'Zilar <setup-sentinel@example.com>';

let context: TestContext;
let liveMailer: CurrentMailer;
let sentThrough: Mailer | null;
let sentTo: Array<{ email: string; code: string }>;
let swapped: Mailer | null;

function failingSend(): SetupApiDependencies['sendTestCode'] {
  return async () => {
    throw new Error('535 rejected: bad key');
  };
}

function recordingSend(): SetupApiDependencies['sendTestCode'] {
  return async ({ mailer, email }) => {
    sentThrough = mailer;
    // Drive the same OTP path production uses, without a provider: mint
    // the real code through the auth server and deliver it into the
    // context's test mailer, so the admin could complete sign-in.
    const otp = await context.auth.api.createVerificationOTP({
      body: { email, type: 'sign-in' },
    });
    await context.mailer.sendOtp(email, otp, 'sign-in');
    sentTo.push({ email, code: otp });
  };
}

function appFor(overrides: Partial<SetupApiDependencies> = {}) {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    mailer: liveMailer,
    audit: createAuditRecorder({ db: context.db, logger: context.logger }),
    setup: {
      getClientIp: () => '10.9.9.9',
      sendTestCode: recordingSend(),
      swapMailer: (mailer: Mailer) => {
        swapped = mailer;
        liveMailer.use(mailer);
      },
      ...overrides,
    },
  });
}

async function postSetup(
  app: ReturnType<typeof createApp>,
  body: unknown,
  ip = '10.9.9.9',
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  context = await createTestContext();
  liveMailer = new CurrentMailer(context.mailer);
  sentThrough = null;
  sentTo = [];
  swapped = null;
});

afterEach(async () => {
  await context.close();
});

describe('setup status', () => {
  it('reports needsSetup true on a fresh database', async () => {
    const app = appFor();
    const response = await app.request(`${TEST_BASE_URL}/api/setup/status`);
    expect(response.status).toBe(200);
    // The test config defaults to the console transport, so mail counts
    // as configured while setup is still open.
    expect(await response.json()).toEqual({ needsSetup: true, mailConfigured: true });
  });

  it('reports needsSetup false once a user exists, without touching mail state', async () => {
    const app = appFor();
    await context.db.insert(user).values({
      id: 'u-admin',
      name: 'Admin',
      email: 'admin@example.com',
      emailVerified: true,
    });
    const response = await app.request(`${TEST_BASE_URL}/api/setup/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ needsSetup: false, mailConfigured: true });
  });

  it('reports mailConfigured false when the transport is unconfigured', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: { ...context.config, MAIL_TRANSPORT: undefined },
      auth: context.auth,
      adminClient: context.adminClient,
      mailer: liveMailer,
      setup: { getClientIp: () => '10.9.9.9', sendTestCode: recordingSend() },
    });
    const response = await app.request(`${TEST_BASE_URL}/api/setup/status`);
    expect(await response.json()).toEqual({ needsSetup: true, mailConfigured: false });
  });
});

describe('POST /api/setup', () => {
  const validBody = {
    resendApiKey: SENTINEL_KEY,
    from: SENTINEL_FROM,
    adminEmail: 'Admin@Example.com',
  };

  it('stores encrypted settings, creates the invite and sends the code', async () => {
    const app = appFor();
    const response = await postSetup(app, validBody);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; inviteCode: string };
    expect(body.ok).toBe(true);
    expect(typeof body.inviteCode).toBe('string');
    expect(body.inviteCode.length).toBeGreaterThan(10);

    // The settings round-trip through the cipher.
    const stored = await getMailSettings(context.db, settingsCipherFor(context.config));
    expect(stored).toEqual({ resendApiKey: SENTINEL_KEY, from: SENTINEL_FROM });

    // The key is stored encrypted, never in clear text.
    const rows = await context.db.select().from(instanceSettings);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get(RESEND_API_KEY_SETTING)).not.toContain(SENTINEL_KEY);
    expect(byKey.get(MAIL_FROM_SETTING)).toBe(SENTINEL_FROM);

    // The code went to the admin email and completes a real sign-in.
    expect(sentTo).toHaveLength(1);
    expect(sentTo[0]?.email).toBe('admin@example.com');
    expect(swapped).not.toBeNull();
    expect(sentThrough).toBe(swapped);
  });

  it('the admin can complete sign-in with the emailed code and the invite', async () => {
    const app = appFor();
    const response = await postSetup(app, validBody);
    const { inviteCode } = (await response.json()) as { inviteCode: string };
    const otp = context.mailer.codeFor('admin@example.com');

    const signIn = await app.request(`${TEST_BASE_URL}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.9.9.10',
        'x-zilar-invite': inviteCode,
      },
      body: JSON.stringify({ email: 'admin@example.com', otp }),
    });
    expect(signIn.status).toBe(200);

    // Setup is now closed: status flips and POST answers the same 404 as
    // an unknown route.
    expect(await needsSetup(context.db)).toBe(false);
    const status = await app.request(`${TEST_BASE_URL}/api/setup/status`);
    expect(await status.json()).toEqual({ needsSetup: false, mailConfigured: true });
    expect((await postSetup(app, validBody)).status).toBe(404);
  });

  it('rolls the settings back and answers 422 when the test send fails', async () => {
    const app = appFor({ sendTestCode: failingSend() });
    const response = await postSetup(app, validBody);

    expect(response.status).toBe(422);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ error: { code: 'mail_send_failed' } });
    // No provider detail and no secret in the response.
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(raw).not.toContain('resend');
    // Match the provider's error text, not the random requestId: the id can
    // contain the digits "535" by chance.
    expect(raw).not.toContain('535 rejected');
    expect(raw).not.toContain('bad key');
    expect(await getMailSettings(context.db, settingsCipherFor(context.config))).toBeNull();
    expect(swapped).toBeNull();
    // Setup stays open for a retry.
    expect(await needsSetup(context.db)).toBe(true);
  });

  it('a failed send leaves no invite rows behind', async () => {
    const app = appFor({ sendTestCode: failingSend() });
    const response = await postSetup(app, validBody);

    expect(response.status).toBe(422);
    const rows = await context.db.select().from(invites);
    expect(rows).toHaveLength(0);
  });

  it('still answers 422 when the rollback itself fails', async () => {
    const app = appFor({ sendTestCode: failingSend() });
    // The rollback transaction is the third `runSql` call on this path:
    // `needsSetup` (the pre-check), the setup transaction, then the rollback.
    // Break the rollback's runtime: the cleanup failure must never mask the
    // specified 422 or leak anything (the T-0669 pattern).
    const passthrough = vi.mocked(sqlRuntimeFor).getMockImplementation();
    let calls = 0;
    vi.mocked(sqlRuntimeFor).mockImplementation((db) => {
      calls += 1;
      if (calls === 3) {
        return {
          runPromise: () => Promise.reject(new Error('database is down')),
        } as unknown as SqlRuntime;
      }
      return passthrough!(db);
    });
    try {
      const response = await postSetup(app, validBody);
      expect(response.status).toBe(422);
      expect(calls).toBe(3);
      const raw = await response.text();
      expect(JSON.parse(raw)).toMatchObject({ error: { code: 'mail_send_failed' } });
      expect(raw).not.toContain(SENTINEL_KEY);
      expect(raw).not.toContain('down');
      expect(context.logOutput()).not.toContain(SENTINEL_KEY);
    } finally {
      vi.mocked(sqlRuntimeFor).mockImplementation(passthrough!);
    }
  });

  it('rejects invalid bodies without touching settings', async () => {
    const app = appFor();
    for (const body of [
      { resendApiKey: '', from: SENTINEL_FROM, adminEmail: 'admin@example.com' },
      { resendApiKey: SENTINEL_KEY, from: '', adminEmail: 'admin@example.com' },
      { resendApiKey: SENTINEL_KEY, from: SENTINEL_FROM, adminEmail: 'not-an-email' },
      {},
      null,
    ]) {
      const response = await postSetup(app, body, `10.9.8.${Math.floor(Math.random() * 200) + 1}`);
      expect(response.status).toBe(400);
    }
    expect(await getMailSettings(context.db, settingsCipherFor(context.config))).toBeNull();
    expect(sentTo).toHaveLength(0);
  });

  it('answers the same 404 once an admin exists', async () => {
    await context.db.insert(user).values({
      id: 'u-admin',
      name: 'Admin',
      email: 'admin@example.com',
      emailVerified: true,
    });
    const app = appFor();
    const response = await postSetup(app, validBody);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(await getMailSettings(context.db, settingsCipherFor(context.config))).toBeNull();
    expect(sentTo).toHaveLength(0);
  });

  it('rate limits per IP: the 6th attempt in the window is rejected', async () => {
    const app = appFor({ sendTestCode: failingSend() });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < SETUP_RATE_LIMIT_MAX + 1; attempt += 1) {
      statuses.push((await postSetup(app, validBody)).status);
    }
    expect(statuses.slice(0, SETUP_RATE_LIMIT_MAX)).toEqual(Array(SETUP_RATE_LIMIT_MAX).fill(422));
    expect(statuses[SETUP_RATE_LIMIT_MAX]).toBe(429);
  });

  it('keeps the key out of logs and audit detail', async () => {
    const app = appFor({ sendTestCode: failingSend() });
    await postSetup(app, validBody);
    expect(context.logOutput()).not.toContain(SENTINEL_KEY);

    const okApp = appFor();
    const ok = await postSetup(okApp, validBody, '10.9.9.10');
    expect(ok.status).toBe(200);
    expect(context.logOutput()).not.toContain(SENTINEL_KEY);

    // The audit row carries ids only: detail is null and no audit column
    // holds the key, the sender, the admin email or the invite code.
    const auditRows = await context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'setup.completed'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.detail).toBeNull();
    expect(JSON.stringify(auditRows[0])).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(auditRows[0])).not.toContain(SENTINEL_FROM);
    expect(JSON.stringify(auditRows[0])).not.toContain('admin@example.com');
    const { inviteCode } = (await ok.json()) as { inviteCode: string };
    expect(JSON.stringify(auditRows[0])).not.toContain(inviteCode);
  });

  it('answers 404 after setup even when the rate limit is exhausted', async () => {
    const app = appFor();
    // Burn the whole IP budget while setup is still open (400s count).
    for (let attempt = 0; attempt < SETUP_RATE_LIMIT_MAX; attempt += 1) {
      expect((await postSetup(app, {})).status).toBe(400);
    }
    expect((await postSetup(app, {})).status).toBe(429);
    // Setup finishes another way (a user exists): every caller now gets
    // the same 404 as an unknown route, never a 429.
    await context.db.insert(user).values({
      id: 'u-admin',
      name: 'Admin',
      email: 'admin@example.com',
      emailVerified: true,
    });
    const response = await postSetup(app, validBody);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('setup route shape', () => {
  it('registers exactly GET /api/setup/status and POST /api/setup', () => {
    const paths = SETUP_API_ROUTES.map((route) => `${route.method}|${route.path}`);
    expect(paths).toContain('GET|/api/setup/status');
    expect(paths).toContain('POST|/api/setup');
    expect(paths).toHaveLength(2);
  });

  it('the invite has the single-use bootstrap shape', async () => {
    const app = appFor();
    const response = await postSetup(app, {
      resendApiKey: SENTINEL_KEY,
      from: SENTINEL_FROM,
      adminEmail: 'admin@example.com',
    });
    const { inviteCode } = (await response.json()) as { inviteCode: string };
    const [row] = await context.db.select().from(invites).where(eq(invites.code, inviteCode));
    expect(row?.createdBy).toBeNull();
    expect(row?.maxUses).toBe(1);
    expect(row?.uses).toBe(0);
  });

  it('uses at most one invite per setup (no duplicate rows)', async () => {
    const { invites } = await import('../db/schema');
    const app = appFor();
    await postSetup(app, {
      resendApiKey: SENTINEL_KEY,
      from: SENTINEL_FROM,
      adminEmail: 'admin@example.com',
    });
    const [row] = await context.db
      .select({ total: count() })
      .from(invites)
      .then((rows) => rows as Array<{ total: number }>);
    expect(Number(row?.total ?? 0)).toBe(1);
  });
});
