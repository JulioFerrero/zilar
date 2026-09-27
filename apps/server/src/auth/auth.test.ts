import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { invites, session, user } from '../db/schema';
import { TEST_SECRET, createTestContext, type TestContext } from '../test-support';
import { INVITE_HEADER } from './auth';
import { consumeInvite, createInvite, findInviteByCode, revokeInvite } from './invites';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

function appFor(context: TestContext): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
  });
}

async function post(
  app: TestApp,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function sendSignInOtp(app: TestApp, email: string): Promise<Response> {
  return post(app, '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
}

async function signInWithOtp(
  app: TestApp,
  input: { email: string; otp: string; invite?: string },
): Promise<Response> {
  const headers = input.invite ? { [INVITE_HEADER]: input.invite } : {};
  return post(app, '/api/auth/sign-in/email-otp', { email: input.email, otp: input.otp }, headers);
}

function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='));
  if (!cookie) {
    throw new Error('expected a session cookie in the response');
  }
  return cookie.split(';')[0] ?? '';
}

async function bootstrap(
  context: TestContext,
  email: string,
  invite: string,
): Promise<{ app: TestApp; response: Response }> {
  const app = appFor(context);
  await sendSignInOtp(app, email);
  const otp = context.mailer.codeFor(email);
  const response = await signInWithOtp(app, { email, otp, invite });
  return { app, response };
}

describe('auth flows', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('(a) bootstraps the first user through an invite and issues a session', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app, response } = await bootstrap(context, 'first@example.com', invite.code);

    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);

    const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { id: string; email: string };
    expect(body.email).toBe('first@example.com');
    expect(body.id).toBeTruthy();

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(1);
  });

  it('(b) rejects a new email without an invite and creates nothing', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });

    await sendSignInOtp(app, 'no-invite@example.com');
    const otp = context.mailer.codeFor('no-invite@example.com');
    const response = await signInWithOtp(app, { email: 'no-invite@example.com', otp });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
    expect(await context.db.select().from(session)).toHaveLength(0);

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(0);
  });

  it('(c) rejects an expired invite', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, expiresInDays: -1 });

    await sendSignInOtp(app, 'expired@example.com');
    const otp = context.mailer.codeFor('expired@example.com');
    const response = await signInWithOtp(app, {
      email: 'expired@example.com',
      otp,
      invite: invite.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(c) rejects a revoked invite', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    await revokeInvite(context.db, invite.code);

    await sendSignInOtp(app, 'revoked@example.com');
    const otp = context.mailer.codeFor('revoked@example.com');
    const response = await signInWithOtp(app, {
      email: 'revoked@example.com',
      otp,
      invite: invite.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(c) rejects a used-up invite', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 1 });
    await consumeInvite(context.db, invite.code);

    await sendSignInOtp(app, 'used-up@example.com');
    const otp = context.mailer.codeFor('used-up@example.com');
    const response = await signInWithOtp(app, {
      email: 'used-up@example.com',
      otp,
      invite: invite.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(d) lets exactly one of two concurrent sign-ups consume the last use', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 1 });

    await sendSignInOtp(app, 'race-a@example.com');
    await sendSignInOtp(app, 'race-b@example.com');
    const otpA = context.mailer.codeFor('race-a@example.com');
    const otpB = context.mailer.codeFor('race-b@example.com');

    const [responseA, responseB] = await Promise.all([
      signInWithOtp(app, { email: 'race-a@example.com', otp: otpA, invite: invite.code }),
      signInWithOtp(app, { email: 'race-b@example.com', otp: otpB, invite: invite.code }),
    ]);

    expect([responseA.status, responseB.status].sort((a, b) => a - b)).toEqual([200, 400]);

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(1);
    expect(await context.db.select().from(user)).toHaveLength(1);
  });

  it('(e) signs an existing user in again without an invite', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app } = await bootstrap(context, 'returning@example.com', invite.code);

    await sendSignInOtp(app, 'returning@example.com');
    const otp = context.mailer.codeFor('returning@example.com');
    const response = await signInWithOtp(app, { email: 'returning@example.com', otp });

    expect(response.status).toBe(200);
  });

  it('(f) locks the OTP after five wrong attempts', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    await sendSignInOtp(app, 'attempts@example.com');
    const otp = context.mailer.codeFor('attempts@example.com');
    const wrongOtp = otp === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await signInWithOtp(app, {
        email: 'attempts@example.com',
        otp: wrongOtp,
        invite: invite.code,
      });
      expect(response.status).toBe(400);
    }

    const locked = await signInWithOtp(app, {
      email: 'attempts@example.com',
      otp,
      invite: invite.code,
    });
    expect(locked.status).toBe(403);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(g) authenticates with a bearer token', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app, response } = await bootstrap(context, 'bearer@example.com', invite.code);

    const token = response.headers.get('set-auth-token');
    expect(token).toBeTruthy();
    if (!token) {
      throw new Error('expected a set-auth-token header');
    }

    const me = await app.request(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'bearer@example.com' });
  });

  it('(h) exposes only validity publicly and restricts revoke to the creator', async () => {
    const creatorInvite = await createInvite(context.db, { createdBy: null });
    const { app, response: creatorResponse } = await bootstrap(
      context,
      'creator@example.com',
      creatorInvite.code,
    );
    const creatorCookie = sessionCookie(creatorResponse);

    const otherInvite = await createInvite(context.db, { createdBy: null });
    const { response: otherResponse } = await bootstrap(
      context,
      'other@example.com',
      otherInvite.code,
    );
    const otherCookie = sessionCookie(otherResponse);

    const created = await app.request(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: { cookie: creatorCookie },
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { code: string; url: string; expiresAt: string };
    expect(createdBody.code).toBeTruthy();
    expect(createdBody.url).toBe(`${BASE_URL}/invite/${createdBody.code}`);

    const lookup = await app.request(`${BASE_URL}/api/invites/${createdBody.code}`);
    expect(await lookup.json()).toEqual({ valid: true });

    const bogus = await app.request(`${BASE_URL}/api/invites/not-a-real-code`);
    expect(await bogus.json()).toEqual({ valid: false });

    const forbidden = await app.request(`${BASE_URL}/api/invites/${createdBody.code}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(forbidden.status).toBe(403);

    const revoked = await app.request(`${BASE_URL}/api/invites/${createdBody.code}`, {
      method: 'DELETE',
      headers: { cookie: creatorCookie },
    });
    expect(revoked.status).toBe(200);

    const afterRevoke = await app.request(`${BASE_URL}/api/invites/${createdBody.code}`);
    expect(await afterRevoke.json()).toEqual({ valid: false });
  });

  it('sets an HTTP-only, SameSite=Lax session cookie that is Secure in production', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { response } = await bootstrap(context, 'cookie@example.com', invite.code);
    const rawCookie = response.headers
      .getSetCookie()
      .find((value) => value.includes('better-auth.session_token='));
    expect(rawCookie).toContain('HttpOnly');
    expect(rawCookie).toContain('SameSite=Lax');

    const production = await createTestContext({ nodeEnv: 'production' });
    try {
      const productionInvite = await createInvite(production.db, { createdBy: null });
      const { response: productionResponse } = await bootstrap(
        production,
        'secure@example.com',
        productionInvite.code,
      );
      const rawProductionCookie = productionResponse.headers
        .getSetCookie()
        .find((value) => value.includes('better-auth.session_token='));
      expect(rawProductionCookie).toContain('Secure');
    } finally {
      await production.close();
    }
  });

  it('requires a session for /api/me and POST /api/invites', async () => {
    const app = appFor(context);

    const me = await app.request(`${BASE_URL}/api/me`);
    expect(me.status).toBe(401);

    const invite = await app.request(`${BASE_URL}/api/invites`, { method: 'POST' });
    expect(invite.status).toBe(401);
  });

  it('does not expose email/password sign-up', async () => {
    const app = appFor(context);

    const response = await post(app, '/api/auth/sign-up/email', {
      email: 'password@example.com',
      password: 'hunter2hunter2',
      name: 'Password',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('rejects a valid OTP presented with an unusable invite', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    await revokeInvite(context.db, invite.code);

    await sendSignInOtp(app, 'invalid-invite@example.com');
    const otp = context.mailer.codeFor('invalid-invite@example.com');
    const response = await signInWithOtp(app, {
      email: 'invalid-invite@example.com',
      otp,
      invite: invite.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(j) never logs the OTP, a session token or the auth secret outside development/test', async () => {
    const production = await createTestContext({ nodeEnv: 'production' });
    try {
      const invite = await createInvite(production.db, { createdBy: null });
      const { response } = await bootstrap(production, 'prod@example.com', invite.code);
      expect(response.status).toBe(200);

      const otp = production.mailer.codeFor('prod@example.com');
      const token = response.headers.get('set-auth-token') ?? '';
      const output = production.logOutput();

      expect(otp).toHaveLength(6);
      expect(token).toBeTruthy();
      expect(output).not.toContain(otp);
      expect(output).not.toContain(token);
      expect(output).not.toContain(TEST_SECRET);
    } finally {
      await production.close();
    }
  });

  it('keeps the invites table in sync with the number of successful sign-ups', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });

    for (const email of ['one@example.com', 'two@example.com']) {
      await sendSignInOtp(app, email);
      const otp = context.mailer.codeFor(email);
      const response = await signInWithOtp(app, { email, otp, invite: invite.code });
      expect(response.status).toBe(200);
    }

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(2);
    expect(await context.db.select().from(invites)).toHaveLength(1);
  });
});
