import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { createApp } from '../app';
import { createInvite } from '../auth/invites';
import { INVITE_HEADER } from '../auth/auth';
import { xmppAccounts } from '../db/schema';
import {
  FakeAdminClient,
  TEST_XMPP_DOMAIN,
  createTestContext,
  type TestContext,
} from '../test-support';
import { localpartFor } from './provisioning';
import { TOKEN_RATE_LIMIT_MAX, TOKEN_TTL_SECONDS } from './routes';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

let clientIp = '10.1.0.1';

function appFor(context: TestContext): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
  });
}

async function signIn(
  context: TestContext,
  app: TestApp,
  email: string,
): Promise<{ cookie: string; bearer: string; id: string }> {
  const invite = await createInvite(context.db, { createdBy: null });
  await app.request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': clientIp,
      [INVITE_HEADER]: invite.code,
    },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const otp = context.mailer.codeFor(email);
  const response = await app.request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': clientIp,
      [INVITE_HEADER]: invite.code,
    },
    body: JSON.stringify({ email, otp }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-in failed with ${response.status}`);
  }
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='))!
    .split(';')[0]!;
  const bearer = response.headers.get('set-auth-token') ?? '';
  return { cookie, bearer, id: body.user.id };
}

describe('POST /api/xmpp/token', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    clientIp = `10.1.0.${testCounter}`;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('returns a short-lived token and where to connect', async () => {
    const app = appFor(context);
    const { cookie, id } = await signIn(context, app, 'token@example.com');

    const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jid: string;
      token: string;
      expiresAt: string;
      service: string;
      domain: string;
      mucDomain: string;
    };

    const expectedJid = `${localpartFor(id)}@${TEST_XMPP_DOMAIN}`;
    expect(body.jid).toBe(expectedJid);
    expect(body.service).toBe(context.xmppConfig.wsPublicUrl);
    expect(body.domain).toBe(context.xmppConfig.domain);
    expect(body.mucDomain).toBe(context.xmppConfig.mucDomain);

    const { payload } = await jwtVerify(
      body.token,
      new TextEncoder().encode(context.xmppConfig.jwtSecret),
    );
    expect(payload.jid).toBe(expectedJid);
    expect(typeof payload.exp).toBe('number');

    const expiresAtSeconds = Math.floor(new Date(body.expiresAt).getTime() / 1000);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBe(expiresAtSeconds);
    expect(expiresAtSeconds - nowSeconds).toBeLessThanOrEqual(TOKEN_TTL_SECONDS);
    expect(expiresAtSeconds - nowSeconds).toBeGreaterThan(0);
  });

  it('accepts a bearer token as well as a cookie', async () => {
    const app = appFor(context);
    const { bearer } = await signIn(context, app, 'bearer-token@example.com');

    const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(200);
  });

  it('requires authentication', async () => {
    const app = appFor(context);
    const response = await app.request(`${BASE_URL}/api/xmpp/token`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('retries provisioning lazily when sign-up could not reach ejabberd', async () => {
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;
    const failing = await createTestContext({ adminClient });
    try {
      const app = appFor(failing);
      const { cookie, id } = await signIn(failing, app, 'lazy@example.com');

      const rows = await failing.db.select().from(xmppAccounts);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.provisioned).toBe(false);
      expect(failing.adminClient.registered).toEqual([]);

      failing.adminClient.failRegister = false;
      const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { jid: string };
      expect(body.jid).toBe(`${localpartFor(id)}@${TEST_XMPP_DOMAIN}`);
      expect(failing.adminClient.registered).toEqual([localpartFor(id)]);

      const after = await failing.db.select().from(xmppAccounts);
      expect(after[0]?.provisioned).toBe(true);
    } finally {
      await failing.close();
    }
  });

  it('answers 503 when provisioning keeps failing, and never leaks the token', async () => {
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;
    const failing = await createTestContext({ adminClient });
    try {
      const app = appFor(failing);
      // The sign-in hook already failed to provision, so the route retries.
      const { cookie } = await signIn(failing, app, 'stuck@example.com');

      const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(response.status).toBe(503);
    } finally {
      await failing.close();
    }
  });

  it('rate-limits a user to TOKEN_RATE_LIMIT_MAX requests per 10 minutes', async () => {
    const app = appFor(context);
    const { cookie } = await signIn(context, app, 'limited-token@example.com');

    for (let attempt = 0; attempt < TOKEN_RATE_LIMIT_MAX; attempt += 1) {
      const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(response.status).toBe(200);
    }

    const blocked = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(blocked.status).toBe(429);
  });

  it('rate-limits per user, not globally', async () => {
    const app = appFor(context);
    const first = await signIn(context, app, 'limited-a@example.com');
    const second = await signIn(context, app, 'limited-b@example.com');

    for (let attempt = 0; attempt < TOKEN_RATE_LIMIT_MAX; attempt += 1) {
      await app.request(`${BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie: first.cookie },
      });
    }
    const blocked = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie: first.cookie },
    });
    expect(blocked.status).toBe(429);

    const other = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie: second.cookie },
    });
    expect(other.status).toBe(200);
  });

  it('never writes the token or the JWT secret to the logs', async () => {
    const app = appFor(context);
    const { cookie } = await signIn(context, app, 'logs@example.com');

    const response = await app.request(`${BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };

    const output = context.logOutput();
    expect(output).not.toContain(token);
    expect(output).not.toContain(context.xmppConfig.jwtSecret);
  });
});
