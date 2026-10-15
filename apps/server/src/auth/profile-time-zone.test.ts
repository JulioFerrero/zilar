// The user's time zone (T-1440). The validator is unit-tested; the `PATCH /me`
// / `GET /me` tests store a valid zone and refuse an invalid one, like the bio
// tests in `profile-bio.test.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestContext, type TestContext } from '../test-support';
import { INVITE_HEADER } from './auth';
import { createInvite } from './invites';
import { isValidTimeZone } from './profile-time-zone';

const BASE_URL = 'http://localhost:3000';
const CLIENT_IP = '10.0.0.11';

type TestApp = ReturnType<typeof createApp>;

describe('profile time zone (T-1440)', () => {
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

  describe('isValidTimeZone', () => {
    it('accepts IANA zones', () => {
      expect(isValidTimeZone('Europe/Madrid')).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
    });

    it('rejects an unknown zone', () => {
      expect(isValidTimeZone('Not/AZone')).toBe(false);
    });

    it('rejects a zone longer than 64 characters', () => {
      expect(isValidTimeZone('a'.repeat(65))).toBe(false);
    });
  });

  it('stores a valid zone and returns it on GET /api/me', async () => {
    const application = app();
    const cookie = await signedIn(application, 'zone@example.com');

    const patched = await patchMe(application, cookie, { name: 'Ada', timeZone: 'Europe/Madrid' });
    expect(patched.status).toBe(200);

    const me = await application.request(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: 'Ada', timeZone: 'Europe/Madrid' });
  });

  it('rejects an invalid zone and applies no other part of the PATCH', async () => {
    const application = app();
    const cookie = await signedIn(application, 'zone-invalid@example.com');
    const readMe = async (): Promise<{ name?: string; bio?: string }> =>
      (await application.request(`${BASE_URL}/api/me`, { headers: { cookie } })).json() as {
        name?: string;
        bio?: string;
      };
    const before = await readMe();

    const response = await patchMe(application, cookie, {
      name: 'Mallory',
      bio: 'changed',
      timeZone: 'Not/AZone',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_request', message: 'timeZone must be a valid IANA time zone' },
    });

    const after = await readMe();
    expect(after.name).toBe(before.name);
    expect(after.bio).toBe(before.bio);
  });
});
