import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { invites, session, user, verification, xmppAccounts } from '../db/schema';
import {
  FakeAdminClient,
  TEST_SECRET,
  TEST_XMPP_DOMAIN,
  createTestContext,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { INVITE_HEADER } from './auth';
import {
  consumeInvite,
  createInvite,
  findInviteByCode,
  findUsableInvite,
  revokeInvite,
} from './invites';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

let clientIp = '10.0.0.1';

function appFor(context: TestContext): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
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
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp, ...headers },
    body: JSON.stringify(body),
  });
}

async function sendSignInOtp(app: TestApp, email: string, invite?: string): Promise<Response> {
  const headers = invite ? { [INVITE_HEADER]: invite } : {};
  return post(
    app,
    '/api/auth/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    headers,
  );
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
  await sendSignInOtp(app, email, invite);
  const otp = context.mailer.codeFor(email);
  const response = await signInWithOtp(app, { email, otp, invite });
  return { app, response };
}

describe('auth flows', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    clientIp = `10.0.0.${testCounter}`;
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
    const body = (await me.json()) as { id: string; email: string; jid: string | null };
    expect(body.email).toBe('first@example.com');
    expect(body.id).toBeTruthy();
    expect(body.jid).toBe(`${localpartFor(body.id)}@${TEST_XMPP_DOMAIN}`);

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(1);
  });

  it('(b) rejects sign-up without an invite and creates nothing', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });

    // The code is delivered because the send carries the invite, but the
    // sign-in below omits it, so account creation must be rejected.
    await sendSignInOtp(app, 'no-invite@example.com', invite.code);
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
    const usable = await createInvite(context.db, { createdBy: null });
    const expired = await createInvite(context.db, { createdBy: null, expiresInDays: -1 });

    await sendSignInOtp(app, 'expired@example.com', usable.code);
    const otp = context.mailer.codeFor('expired@example.com');
    const response = await signInWithOtp(app, {
      email: 'expired@example.com',
      otp,
      invite: expired.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(c) rejects a revoked invite', async () => {
    const app = appFor(context);
    const usable = await createInvite(context.db, { createdBy: null });
    const revoked = await createInvite(context.db, { createdBy: null });
    await revokeInvite(context.db, revoked.code);

    await sendSignInOtp(app, 'revoked@example.com', usable.code);
    const otp = context.mailer.codeFor('revoked@example.com');
    const response = await signInWithOtp(app, {
      email: 'revoked@example.com',
      otp,
      invite: revoked.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(c) rejects a used-up invite', async () => {
    const app = appFor(context);
    const usable = await createInvite(context.db, { createdBy: null });
    const usedUp = await createInvite(context.db, { createdBy: null, maxUses: 1 });
    await consumeInvite(context.db, usedUp.code);

    await sendSignInOtp(app, 'used-up@example.com', usable.code);
    const otp = context.mailer.codeFor('used-up@example.com');
    const response = await signInWithOtp(app, {
      email: 'used-up@example.com',
      otp,
      invite: usedUp.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('(d) lets exactly one of two concurrent sign-ups consume the last use', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 1 });

    await sendSignInOtp(app, 'race-a@example.com', invite.code);
    await sendSignInOtp(app, 'race-b@example.com', invite.code);
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
    await sendSignInOtp(app, 'attempts@example.com', invite.code);
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

    // The invite code is a bearer secret: the request log keeps the route
    // shape only, on success and on error.
    const output = context.logOutput();
    expect(output).not.toContain(createdBody.code);
    expect(output).not.toContain('not-a-real-code');
    expect(output).toContain('/api/invites/:code');
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
    const usable = await createInvite(context.db, { createdBy: null });
    const revoked = await createInvite(context.db, { createdBy: null });
    await revokeInvite(context.db, revoked.code);

    await sendSignInOtp(app, 'invalid-invite@example.com', usable.code);
    const otp = context.mailer.codeFor('invalid-invite@example.com');
    const response = await signInWithOtp(app, {
      email: 'invalid-invite@example.com',
      otp,
      invite: revoked.code,
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(user)).toHaveLength(0);
  });

  it('does not send a code to an unknown email without an invite', async () => {
    const app = appFor(context);

    const response = await sendSignInOtp(app, 'stranger@example.com');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(context.mailer.sent).toHaveLength(0);
  });

  it('sends a code to an unknown email with a usable invite and does not consume it', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });

    const response = await sendSignInOtp(app, 'invited@example.com', invite.code);

    expect(response.status).toBe(200);
    expect(context.mailer.codeFor('invited@example.com')).toHaveLength(6);
    const stored = await findUsableInvite(context.db, invite.code);
    expect(stored).not.toBeNull();
    expect(stored?.uses).toBe(0);
  });

  it('sends a code to an existing user without an invite', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app } = await bootstrap(context, 'existing@example.com', invite.code);
    const before = context.mailer.sent.length;

    const response = await sendSignInOtp(app, 'existing@example.com');

    expect(response.status).toBe(200);
    expect(context.mailer.sent.length).toBe(before + 1);
  });

  it('rate-limits the send-OTP endpoint to 3 per 10 minutes per IP', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await sendSignInOtp(app, 'limited@example.com', invite.code);
      expect(response.status).toBe(200);
    }

    const fourth = await sendSignInOtp(app, 'limited@example.com', invite.code);
    expect(fourth.status).toBe(429);
  });

  it('stores OTPs hashed and still verifies the plain code', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });

    await sendSignInOtp(app, 'hashed@example.com', invite.code);
    const otp = context.mailer.codeFor('hashed@example.com');

    const rows = await context.db.select().from(verification);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(otp);

    const response = await signInWithOtp(app, {
      email: 'hashed@example.com',
      otp,
      invite: invite.code,
    });
    expect(response.status).toBe(200);
  });

  it('rejects a cookie-authenticated POST from an untrusted origin', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app, response: signIn } = await bootstrap(
      context,
      'untrusted@example.com',
      invite.code,
    );
    const cookie = sessionCookie(signIn);

    const response = await app.request(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.example' },
    });

    expect(response.status).toBe(403);
  });

  it('allows a cookie-authenticated POST from a trusted origin', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app, response: signIn } = await bootstrap(context, 'trusted@example.com', invite.code);
    const cookie = sessionCookie(signIn);

    const response = await app.request(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost:5173' },
    });

    expect(response.status).toBe(200);
  });

  it('trusts only WEB_ORIGINS in Better Auth origin checks', async () => {
    const sendBody = JSON.stringify({ email: 'origin@example.com', type: 'sign-in' });
    const untrusted = await context.auth.handler(
      new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'better-auth.session_token=fake',
          origin: 'https://evil.example',
        },
        body: sendBody,
      }),
    );
    expect(untrusted.status).toBe(403);

    const trusted = await context.auth.handler(
      new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'better-auth.session_token=fake',
          origin: 'http://localhost:5173',
        },
        body: sendBody,
      }),
    );
    expect(trusted.status).toBe(200);
  });

  it('answers CORS preflight for trusted origins and not for untrusted ones', async () => {
    const app = appFor(context);

    const trusted = await app.request(`${BASE_URL}/api/invites`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-galena-invite',
      },
    });
    expect(trusted.status).toBe(204);
    expect(trusted.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(trusted.headers.get('access-control-allow-credentials')).toBe('true');
    expect(trusted.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-galena-invite',
    );

    const untrusted = await app.request(`${BASE_URL}/api/invites`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(untrusted.headers.get('access-control-allow-origin')).toBeNull();
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
      await sendSignInOtp(app, email, invite.code);
      const otp = context.mailer.codeFor(email);
      const response = await signInWithOtp(app, { email, otp, invite: invite.code });
      expect(response.status).toBe(200);
    }

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(2);
    expect(await context.db.select().from(invites)).toHaveLength(1);
  });

  it('provisions the XMPP account on sign-up', async () => {
    const invite = await createInvite(context.db, { createdBy: null });
    const { app, response } = await bootstrap(context, 'provisioned@example.com', invite.code);
    expect(response.status).toBe(200);
    const me = await app.request(`${BASE_URL}/api/me`, {
      headers: { cookie: sessionCookie(response) },
    });
    const { id } = (await me.json()) as { id: string };
    const localpart = localpartFor(id);

    const rows = await context.db.select().from(xmppAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: id, localpart, provisioned: true });
    expect(context.adminClient.registered).toEqual([localpart]);
  });

  it('still signs the user up when ejabberd is unreachable, with provisioned false', async () => {
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;
    const failing = await createTestContext({ adminClient });
    try {
      const invite = await createInvite(failing.db, { createdBy: null });
      const { response } = await bootstrap(failing, 'offline@example.com', invite.code);
      expect(response.status).toBe(200);

      const rows = await failing.db.select().from(xmppAccounts);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.provisioned).toBe(false);
      expect(failing.adminClient.registered).toEqual([]);
      expect(failing.logOutput()).not.toContain(failing.xmppConfig.jwtSecret);
    } finally {
      await failing.close();
    }
  });

  describe('PATCH /api/me', () => {
    async function signedIn(): Promise<{ app: TestApp; cookie: string; id: string }> {
      const invite = await createInvite(context.db, { createdBy: null });
      const { app, response } = await bootstrap(context, 'profile@example.com', invite.code);
      const cookie = sessionCookie(response);
      const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });
      const { id } = (await me.json()) as { id: string };
      return { app, cookie, id };
    }

    async function patchName(app: TestApp, cookie: string, body: unknown): Promise<Response> {
      return app.request(`${BASE_URL}/api/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    }

    it('sets a trimmed display name and returns it', async () => {
      const { app, cookie } = await signedIn();

      const response = await patchName(app, cookie, { name: '  Ada Lovelace  ' });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ name: 'Ada Lovelace' });

      const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });
      expect(await me.json()).toMatchObject({ name: 'Ada Lovelace' });
    });

    it('returns the JID on GET /api/me', async () => {
      const { app, cookie, id } = await signedIn();

      const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });
      expect(await me.json()).toMatchObject({
        jid: `${localpartFor(id)}@${TEST_XMPP_DOMAIN}`,
      });
    });

    it('rejects an empty or whitespace-only name', async () => {
      const { app, cookie } = await signedIn();
      for (const name of ['', '   ', '\t\n']) {
        const response = await patchName(app, cookie, { name });
        expect(response.status).toBe(400);
      }
    });

    it('rejects a name longer than 64 characters', async () => {
      const { app, cookie } = await signedIn();
      const response = await patchName(app, cookie, { name: 'a'.repeat(65) });
      expect(response.status).toBe(400);
    });

    it('accepts exactly 64 characters', async () => {
      const { app, cookie } = await signedIn();
      const response = await patchName(app, cookie, { name: 'a'.repeat(64) });
      expect(response.status).toBe(200);
    });

    it('rejects control characters', async () => {
      const { app, cookie } = await signedIn();
      for (const name of ['Ada\u0000Lovelace', 'Ada\u001fLovelace', 'Ada\u007fLovelace']) {
        const response = await patchName(app, cookie, { name });
        expect(response.status).toBe(400);
      }
    });

    it('rejects a missing or non-string name', async () => {
      const { app, cookie } = await signedIn();
      expect((await patchName(app, cookie, {})).status).toBe(400);
      expect((await patchName(app, cookie, { name: 42 })).status).toBe(400);
    });

    it('requires authentication', async () => {
      const app = appFor(context);
      const response = await app.request(`${BASE_URL}/api/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Nobody' }),
      });
      expect(response.status).toBe(401);
    });
  });
});
