// The profile bio (T-1258). The `/me` tests proper live in `auth.test.ts`
// (describe 'PATCH /api/me'); these read back the bio that route stores and
// check the by-handle profile of another user carries it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { INVITE_HEADER } from './auth';
import { createInvite } from './invites';

const BASE_URL = 'http://localhost:3000';
const CLIENT_IP = '10.0.0.9';

type TestApp = ReturnType<typeof createApp>;

describe('profile bio (T-1258)', () => {
  let context: TestContext;

  beforeEach(async () => {
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

  async function post(
    application: TestApp,
    path: string,
    body: unknown,
    invite?: string,
  ): Promise<Response> {
    return application.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': CLIENT_IP,
        ...(invite === undefined ? {} : { [INVITE_HEADER]: invite }),
      },
      body: JSON.stringify(body),
    });
  }

  async function signedIn(application: TestApp, email: string): Promise<string> {
    const invite = await createInvite(context.db, { createdBy: null });
    await post(
      application,
      '/api/auth/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      invite.code,
    );
    const otp = context.mailer.codeFor(email);
    const response = await post(
      application,
      '/api/auth/sign-in/email-otp',
      { email, otp },
      invite.code,
    );
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes('better-auth.session_token='));
    if (!cookie) {
      throw new Error('expected a session cookie in the response');
    }
    return cookie.split(';')[0] ?? '';
  }

  function patchMe(application: TestApp, cookie: string, body: unknown): Promise<Response> {
    return application.request(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  it('stores a bio and returns it on GET /api/me', async () => {
    const application = app();
    const cookie = await signedIn(application, 'bio@example.com');

    const patched = await patchMe(application, cookie, { name: 'Ada', bio: 'Hello there' });
    expect(patched.status).toBe(200);

    const me = await application.request(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: 'Ada', bio: 'Hello there' });
  });

  it('rejects a bio over 140 characters or with a line break', async () => {
    const application = app();
    const cookie = await signedIn(application, 'bio-invalid@example.com');

    const tooLong = await patchMe(application, cookie, { name: 'Ada', bio: 'a'.repeat(141) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({
      error: { code: 'invalid_request', message: 'bio must be at most 140 characters' },
    });

    const lineBreak = await patchMe(application, cookie, {
      name: 'Ada',
      bio: 'line one\nline two',
    });
    expect(lineBreak.status).toBe(400);
    expect(await lineBreak.json()).toMatchObject({
      error: { code: 'invalid_request', message: 'bio must not contain control characters' },
    });
  });

  it("returns another user's bio from the by-handle profile", async () => {
    const application = app();
    const cookie = await signedIn(application, 'viewer@example.com');

    const other = await seedUser(context, { name: 'Other' });
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO handles (handle_lower, handle, user_id)
          VALUES ('other_user', 'other_user', ${other})`;
        yield* sql`INSERT INTO user_profiles (user_id, bio) VALUES (${other}, ${'Other bio'})`;
      }),
    );

    const profile = await application.request(`${BASE_URL}/api/users/by-handle/other_user`, {
      headers: { cookie },
    });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({ handle: 'other_user', bio: 'Other bio' });
  });
});
