import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createTestContext, type TestContext } from '../test-support';
import { INVITE_HEADER } from './auth';
import { createInvite } from './invites';

const BASE_URL = 'http://localhost:3000';

type TestApp = ReturnType<typeof createApp>;

let counter = 0;
let clientIp = '10.1.0.1';

function post(app: TestApp, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp, ...headers },
    body: JSON.stringify(body),
  });
}

// Every cookie a response sets, as one `cookie` header value. An expired
// cookie (Max-Age=0) is dropped, like a browser would.
function cookieHeader(response: Response): string {
  const jar = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const expired = attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0');
    if (expired || value === '') {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

describe('session cookie cache', () => {
  let context: TestContext;
  let app: TestApp;
  let signIn: Response;

  beforeEach(async () => {
    counter += 1;
    clientIp = `10.1.0.${counter}`;
    context = await createTestContext();
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const invite = await createInvite(context.db, { createdBy: null });
    const email = 'cache@example.com';
    await post(
      app,
      '/api/auth/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      { [INVITE_HEADER]: invite.code },
    );
    signIn = await post(
      app,
      '/api/auth/sign-in/email-otp',
      { email, otp: context.mailer.codeFor(email) },
      { [INVITE_HEADER]: invite.code },
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await context.close();
  });

  function sessionReads(spy: { mock: { calls: unknown[][] } }): number {
    return spy.mock.calls.filter(([sql]) => /\bsession\b/i.test(String(sql))).length;
  }

  it('sets a session_data cookie that lives five minutes', () => {
    const line = signIn.headers
      .getSetCookie()
      .find((value) => value.includes('better-auth.session_data='));
    expect(line).toBeDefined();
    expect(line?.toLowerCase()).toContain('max-age=300');
  });

  it('serves a cached session without reading the session table', async () => {
    const cookie = cookieHeader(signIn);
    expect(cookie).toContain('better-auth.session_data=');

    const spy = vi.spyOn(context.client, 'query');
    const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });

    expect(me.status).toBe(200);
    expect(sessionReads(spy)).toBe(0);
  });

  it('reads the session table when only the session token is sent', async () => {
    const cookie = cookieHeader(signIn)
      .split('; ')
      .filter((pair) => !pair.includes('session_data'))
      .join('; ');

    const spy = vi.spyOn(context.client, 'query');
    const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie } });

    expect(me.status).toBe(200);
    expect(sessionReads(spy)).toBeGreaterThan(0);
  });

  it('reads the session table for a bearer token', async () => {
    const token = signIn.headers.get('set-auth-token');
    expect(token).toBeTruthy();

    const spy = vi.spyOn(context.client, 'query');
    const me = await app.request(`${BASE_URL}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(me.status).toBe(200);
    expect(sessionReads(spy)).toBeGreaterThan(0);
  });

  it('ends the session at once on sign-out and clears the cache cookie', async () => {
    const cookie = cookieHeader(signIn);
    const signOut = await post(app, '/api/auth/sign-out', {}, { cookie, origin: BASE_URL });
    expect(signOut.status).toBe(200);

    const cleared = signOut.headers.getSetCookie().join('\n').toLowerCase();
    expect(cleared).toContain('better-auth.session_data=;');
    expect(cleared).toContain('max-age=0');

    // The device applies the cleared cookies and keeps nothing: signed out.
    const jar = cookieHeader(signOut);
    const me = await app.request(`${BASE_URL}/api/me`, { headers: { cookie: jar } });
    expect(me.status).toBe(401);

    // Only the token survives (cache cookie dropped): the row is gone.
    const tokenOnly = cookie
      .split('; ')
      .filter((pair) => !pair.includes('session_data'))
      .join('; ');
    const replay = await app.request(`${BASE_URL}/api/me`, { headers: { cookie: tokenOnly } });
    expect(replay.status).toBe(401);
  });

  it('returns the new name from PATCH /api/me when the cache cookie is stale', async () => {
    const cookie = cookieHeader(signIn);
    const response = await app.request(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Ada Lovelace' });
  });
});
