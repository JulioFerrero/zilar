import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestContext, type TestContext } from '../test-support';
import { INVITE_HEADER } from './auth';
import { createInvite } from './invites';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

interface SessionView {
  id: string;
  createdAt: string;
  updatedAt: string;
  userAgent?: string | null;
  current: boolean;
}

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

async function sendSignInOtp(app: TestApp, email: string, invite?: string): Promise<Response> {
  const headers = invite ? { [INVITE_HEADER]: invite } : {};
  return app.request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp, ...headers },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
}

// Signs `email` in and returns the session cookie, so each call is one extra
// signed-in device. The invite travels on both requests, like `auth.test.ts`.
async function signIn(
  context: TestContext,
  app: TestApp,
  email: string,
  invite?: string,
): Promise<string> {
  await sendSignInOtp(app, email, invite);
  const otp = context.mailer.codeFor(email);
  const headers = invite === undefined ? {} : { [INVITE_HEADER]: invite };
  const response = await app.request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp, ...headers },
    body: JSON.stringify({ email, otp }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-in for ${email} failed with ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='));
  if (!cookie) {
    throw new Error('expected a session cookie in the response');
  }
  return cookie.split(';')[0] ?? '';
}

async function listSessions(app: TestApp, cookie: string): Promise<SessionView[]> {
  const response = await app.request(`${BASE_URL}/api/me/sessions`, { headers: { cookie } });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { sessions: SessionView[] };
  return body.sessions;
}

describe('/api/me/sessions', () => {
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

  it('lists only the caller sessions, with exactly one current and no token', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });
    const first = await signIn(context, app, 'a@example.com', invite.code);
    await signIn(context, app, 'a@example.com');
    const other = await signIn(context, app, 'b@example.com', invite.code);

    const sessions = await listSessions(app, first);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    for (const session of sessions) {
      expect(session).not.toHaveProperty('token');
      expect(session).not.toHaveProperty('ipAddress');
      expect(session).not.toHaveProperty('ip_address');
    }

    // The other account sees only its own single session.
    const otherSessions = await listSessions(app, other);
    expect(otherSessions).toHaveLength(1);
    expect(otherSessions[0]?.current).toBe(true);
    const callerIds = new Set(sessions.map((session) => session.id));
    expect(callerIds.has(otherSessions[0]?.id ?? '')).toBe(false);
  });

  it('answers 404 for another user session id and deletes nothing', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });
    const owner = await signIn(context, app, 'owner@example.com', invite.code);
    const stranger = await signIn(context, app, 'stranger@example.com', invite.code);

    const target = (await listSessions(app, owner)).find((session) => session.current);
    expect(target).toBeDefined();
    const response = await app.request(`${BASE_URL}/api/me/sessions/${target?.id ?? ''}`, {
      method: 'DELETE',
      headers: { cookie: stranger },
    });
    expect(response.status).toBe(404);

    const after = await listSessions(app, owner);
    expect(after.map((session) => session.id)).toContain(target?.id);
  });

  it('answers 400 for the calling session itself', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'self@example.com', invite.code);

    const current = (await listSessions(app, cookie)).find((session) => session.current);
    expect(current).toBeDefined();
    const response = await app.request(`${BASE_URL}/api/me/sessions/${current?.id ?? ''}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(response.status).toBe(400);

    const after = await listSessions(app, cookie);
    expect(after.map((session) => session.id)).toContain(current?.id);
  });
});
