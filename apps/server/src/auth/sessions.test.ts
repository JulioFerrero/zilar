import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createTestContext, FakeAdminClient, testSql, type TestContext } from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { INVITE_HEADER } from './auth';
import { createInvite } from './invites';
import { REVOKED_SESSION_KICK_REASON, SIGNED_OUT_SESSION_KICK_REASON } from './sessions';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

// Records each kick in addition to the in-memory admin API, so the revoke and
// sign-out paths can assert who was disconnected and why.
class KickAdminClient extends FakeAdminClient {
  readonly kicks: Array<{ localpart: string; reason: string }> = [];
  failKick = false;

  kickUser(localpart: string, reason: string): Promise<void> {
    if (this.failKick) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    this.kicks.push({ localpart, reason });
    return Promise.resolve();
  }
}

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

async function userIdFor(context: TestContext, email: string): Promise<string> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`;
    }),
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`no user for ${email}`);
  }
  return id;
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

  it('ends the user XMPP streams when a device is revoked', async () => {
    const adminClient = new KickAdminClient();
    await context.close();
    context = await createTestContext({ adminClient });
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });
    const cookie = await signIn(context, app, 'revoke@example.com', invite.code);
    await signIn(context, app, 'revoke@example.com');

    const target = (await listSessions(app, cookie)).find((session) => !session.current);
    expect(target).toBeDefined();
    const response = await app.request(`${BASE_URL}/api/me/sessions/${target?.id ?? ''}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(response.status).toBe(204);

    const userId = await userIdFor(context, 'revoke@example.com');
    expect(adminClient.kicks).toEqual([
      { localpart: localpartFor(userId), reason: REVOKED_SESSION_KICK_REASON },
    ]);
  });

  it('keeps the revoke when the XMPP kick fails', async () => {
    const adminClient = new KickAdminClient();
    adminClient.failKick = true;
    await context.close();
    context = await createTestContext({ adminClient });
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });
    const cookie = await signIn(context, app, 'kick-fails@example.com', invite.code);
    await signIn(context, app, 'kick-fails@example.com');

    const target = (await listSessions(app, cookie)).find((session) => !session.current);
    expect(target).toBeDefined();
    const response = await app.request(`${BASE_URL}/api/me/sessions/${target?.id ?? ''}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(response.status).toBe(204);

    const after = await listSessions(app, cookie);
    expect(after.map((session) => session.id)).not.toContain(target?.id);
    expect(context.logOutput()).toContain('could not end the XMPP sessions');
  });

  it('ends the user XMPP streams on sign-out', async () => {
    const adminClient = new KickAdminClient();
    await context.close();
    context = await createTestContext({ adminClient });
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'signout@example.com', invite.code);

    const response = await app.request(`${BASE_URL}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);

    const userId = await userIdFor(context, 'signout@example.com');
    expect(adminClient.kicks).toEqual([
      { localpart: localpartFor(userId), reason: SIGNED_OUT_SESSION_KICK_REASON },
    ]);
  });

  it('does not end the XMPP streams when Better Auth cleans up an expired session', async () => {
    const adminClient = new KickAdminClient();
    await context.close();
    context = await createTestContext({ adminClient });
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'expired@example.com', invite.code);
    const userId = await userIdFor(context, 'expired@example.com');

    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE "session"
          SET expires_at = now() - interval '1 hour'
          WHERE user_id = ${userId}`;
      }),
    );

    // The stale cookie makes one call; get-session deletes the expired row.
    const response = await app.request(`${BASE_URL}/api/me/sessions`, { headers: { cookie } });
    expect(response.status).toBe(401);

    expect(adminClient.kicks).toEqual([]);
  });
});

// T-1981: the app has its own `/api/me/sessions` and `PATCH /api/me`, so the
// matching Better Auth routes must not answer.
describe('Better Auth built-in routes', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    clientIp = `10.1.1.${testCounter}`;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('does not serve the built-in list-sessions route', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'builtin-list@example.com', invite.code);

    const response = await app.request(`${BASE_URL}/api/auth/list-sessions`, {
      headers: { cookie },
    });
    expect([403, 404]).toContain(response.status);
    // No session row, and above all no session token, reaches the caller.
    expect(await response.text()).not.toContain('"token"');
  });

  it('does not let the built-in update-user route change the profile', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'builtin-update@example.com', invite.code);
    const before = await me(app, cookie);

    const response = await app.request(`${BASE_URL}/api/auth/update-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Hijacked', image: 'https://evil.example/pixel.png' }),
    });
    expect([403, 404]).toContain(response.status);

    const after = await me(app, cookie);
    expect(after.name).toBe(before.name);
    expect(after.image).toBe(before.image);
  });

  it('still renames the user through PATCH /api/me', async () => {
    const app = appFor(context);
    const invite = await createInvite(context.db, { createdBy: null });
    const cookie = await signIn(context, app, 'builtin-rename@example.com', invite.code);

    const response = await app.request(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Ada Lovelace' });
    expect((await me(app, cookie)).name).toBe('Ada Lovelace');
  });

  async function me(app: TestApp, cookie: string): Promise<{ name: string; image: string | null }> {
    const response = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return (await response.json()) as { name: string; image: string | null };
  }
});
