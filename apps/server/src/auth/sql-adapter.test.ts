import { betterAuth } from 'better-auth';
import { bearer, emailOTP } from 'better-auth/plugins';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { user } from '../db/schema';
import { createTestContext, type TestContext } from '../test-support';
import { effectSqlAdapter } from './sql-adapter';
import { OTP_ALLOWED_ATTEMPTS, OTP_EXPIRES_IN_SECONDS, OTP_LENGTH } from './auth';

const BASE_URL = 'http://localhost:3000';

// A fresh factory instance per call: `createTestContext` registers the
// effect/sql runtime the adapter runs on.
function adapterFor(context: TestContext) {
  return effectSqlAdapter(context.db)({});
}

describe('effectSqlAdapter', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('creates a user and finds it by id and by unique email', async () => {
    const adapter = adapterFor(context);
    const created = await adapter.create<{ id: string; name: string; email: string }>({
      model: 'user',
      data: { name: 'Ada', email: 'ada@example.com' },
    });

    expect(created.id).toBeTruthy();
    expect(created.email).toBe('ada@example.com');

    const byId = await adapter.findOne<{ id: string; email: string; emailVerified: boolean }>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    });
    expect(byId?.email).toBe('ada@example.com');
    expect(byId?.emailVerified).toBe(false);

    const byEmail = await adapter.findOne<{ id: string }>({
      model: 'user',
      where: [{ field: 'email', value: 'ada@example.com' }],
    });
    expect(byEmail?.id).toBe(created.id);

    const missing = await adapter.findOne({
      model: 'user',
      where: [{ field: 'email', value: 'nobody@example.com' }],
    });
    expect(missing).toBeNull();
  });

  it('finds a session by its unique token', async () => {
    const adapter = adapterFor(context);
    const created = await adapter.create<{ id: string; name: string; email: string }>({
      model: 'user',
      data: { name: 'Grace', email: 'grace@example.com' },
    });

    await adapter.create({
      model: 'session',
      data: {
        token: 'session-token-1',
        userId: created.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
      },
    });

    const session = await adapter.findOne<{ token: string; userId: string; ipAddress: string }>({
      model: 'session',
      where: [{ field: 'token', value: 'session-token-1' }],
    });
    expect(session).toMatchObject({
      token: 'session-token-1',
      userId: created.id,
      ipAddress: '10.0.0.1',
    });
  });

  it('updates a row and returns the updated values', async () => {
    const adapter = adapterFor(context);
    const created = await adapter.create<{ id: string; name: string; email: string }>({
      model: 'user',
      data: { name: 'Grace', email: 'grace@example.com' },
    });

    const updated = await adapter.update<{ id: string; name: string }>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
      update: { name: 'Grace Hopper' },
    });
    expect(updated?.name).toBe('Grace Hopper');

    const reread = await adapter.findOne<{ name: string }>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    });
    expect(reread?.name).toBe('Grace Hopper');
  });

  it('counts and filters with `in` and `OR` connectors', async () => {
    const adapter = adapterFor(context);
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      await adapter.create({
        model: 'user',
        data: { name: email.split('@')[0] as string, email },
      });
    }

    const inFilter = await adapter.findMany<{ email: string }>({
      model: 'user',
      where: [{ field: 'email', operator: 'in', value: ['a@example.com', 'b@example.com'] }],
      limit: 10,
    });
    expect(inFilter.map((row) => row.email).sort()).toEqual(['a@example.com', 'b@example.com']);

    const orFilter = await adapter.findMany<{ email: string }>({
      model: 'user',
      where: [
        { field: 'email', value: 'a@example.com' },
        { field: 'email', value: 'c@example.com', connector: 'OR' },
      ],
      limit: 10,
    });
    expect(orFilter).toHaveLength(2);

    const count = await adapter.count({
      model: 'user',
      where: [{ field: 'email', operator: 'in', value: ['a@example.com', 'c@example.com'] }],
    });
    expect(count).toBe(2);

    const total = await adapter.count({ model: 'user' });
    expect(total).toBe(3);
  });

  it('deleteMany removes exactly the matching rows', async () => {
    const adapter = adapterFor(context);
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      await adapter.create({
        model: 'user',
        data: { name: email.split('@')[0] as string, email },
      });
    }

    const removed = await adapter.deleteMany({
      model: 'user',
      where: [{ field: 'email', operator: 'in', value: ['a@example.com', 'b@example.com'] }],
    });
    expect(removed).toBe(2);
    expect(await adapter.count({ model: 'user' })).toBe(1);

    const remaining = await adapter.findMany<{ email: string }>({ model: 'user', limit: 10 });
    expect(remaining.map((row) => row.email)).toEqual(['c@example.com']);
  });

  it('round-trips account and verification rows', async () => {
    const adapter = adapterFor(context);
    const created = await adapter.create<{ id: string; name: string; email: string }>({
      model: 'user',
      data: { name: 'Ada', email: 'ada@example.com' },
    });

    await adapter.create({
      model: 'account',
      data: {
        accountId: 'account-1',
        providerId: 'credential',
        userId: created.id,
        password: 'hashed',
      },
    });
    const account = await adapter.findOne<{ accountId: string; userId: string }>({
      model: 'account',
      where: [{ field: 'userId', value: created.id }],
    });
    expect(account).toMatchObject({ accountId: 'account-1', userId: created.id });

    await adapter.create({
      model: 'verification',
      data: {
        identifier: 'ada@example.com',
        value: 'hashed-otp',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const verification = await adapter.findOne<{ identifier: string; value: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'ada@example.com' }],
    });
    expect(verification).toMatchObject({ identifier: 'ada@example.com', value: 'hashed-otp' });

    expect(
      await adapter.deleteMany({
        model: 'verification',
        where: [{ field: 'identifier', value: 'ada@example.com' }],
      }),
    ).toBe(1);
  });

  it('stores snake_case columns behind the canonical field names', async () => {
    const adapter = adapterFor(context);
    await adapter.create({
      model: 'user',
      data: { name: 'Ada', email: 'ada@example.com' },
    });

    const rows = await context.db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailVerified).toBe(false);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe('better-auth on the effect/sql adapter', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function buildAuth() {
    return betterAuth({
      baseURL: context.config.BETTER_AUTH_URL,
      secret: context.config.BETTER_AUTH_SECRET,
      database: effectSqlAdapter(context.db),
      emailAndPassword: { enabled: false },
      telemetry: { enabled: false },
      logger: { disabled: true },
      trustedOrigins: context.config.WEB_ORIGINS,
      plugins: [
        emailOTP({
          otpLength: OTP_LENGTH,
          expiresIn: OTP_EXPIRES_IN_SECONDS,
          allowedAttempts: OTP_ALLOWED_ATTEMPTS,
          storeOTP: 'hashed',
          async sendVerificationOTP({ email, otp, type }) {
            await context.mailer.sendOtp(email, otp, type);
          },
        }),
        bearer(),
      ],
    });
  }

  it('signs a user up and back in through the email OTP flow', async () => {
    const auth = buildAuth();
    const email = 'otp@example.com';

    const send = await auth.handler(
      new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, type: 'sign-in' }),
      }),
    );
    expect(send.status).toBe(200);

    const otp = context.mailer.codeFor(email);
    expect(otp).toHaveLength(OTP_LENGTH);

    const signIn = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      }),
    );
    expect(signIn.status).toBe(200);
    expect(
      signIn.headers.getSetCookie().some((cookie) => cookie.includes('better-auth.session_token=')),
    ).toBe(true);

    const rows = await context.db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(email);
  });
});
