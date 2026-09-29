import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createInvite } from '../auth/invites';
import { INVITE_HEADER } from '../auth/auth';
import { createTestContext, type TestApp, type TestContext } from '../test-support';
import { loadPushSpikeConfig } from './spike-config';
import { createMemorySubscriptionStore } from './subscriptions';

const BASE_URL = 'http://localhost:3000';

let context: TestContext;
let app: TestApp;
let clientIp = '10.9.0.1';

async function signUp(email: string, ip: string): Promise<string> {
  const invite = await createInvite(context.db, { createdBy: null });
  const headers = {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
    [INVITE_HEADER]: invite.code,
  };
  await app.request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const otp = context.mailer.codeFor(email);
  const response = await app.request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-up for ${email} failed with ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='))
    ?.split(';')[0];
  if (!cookie) {
    throw new Error(`sign-up for ${email} returned no session cookie`);
  }
  return cookie;
}

function subscriptionBody() {
  return {
    endpoint: 'https://push.example.com/subscription/abc123',
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  };
}

describe('push spike routes', () => {
  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function buildApp(spikeEnv: Record<string, string | undefined> = {}): TestApp {
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      pushSpike: {
        config: loadPushSpikeConfig(spikeEnv),
        store: createMemorySubscriptionStore(),
      },
    });
    return app;
  }

  it('answers 404 when the spike is disabled (the default)', async () => {
    buildApp();
    clientIp = '10.9.0.11';
    const cookie = await signUp('spike-off@example.com', clientIp);
    const res = await app.request(`${BASE_URL}/api/push-spike/subscribe`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(subscriptionBody()),
    });
    expect(res.status).toBe(404);
  });

  it('answers 401 without a session even when the spike is disabled', async () => {
    buildApp();
    const res = await app.request(`${BASE_URL}/api/push-spike/config`);
    expect(res.status).toBe(401);
  });

  it('stores a valid subscription and returns the enable data when enabled', async () => {
    buildApp({
      PUSH_SPIKE_ENABLED: 'true',
      PUSH_COMPONENT_JID: 'push.galena.localhost',
      PUSH_VAPID_PUBLIC_KEY: 'public-key',
    });
    clientIp = '10.9.0.12';
    const cookie = await signUp('spike-on@example.com', clientIp);
    const res = await app.request(`${BASE_URL}/api/push-spike/subscribe`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(subscriptionBody()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jid: string; node: string; vapidPublicKey: string };
    expect(body.jid).toBe('push.galena.localhost');
    expect(body.node).toMatch(/^spike-[0-9a-f]{8}$/);
    expect(body.vapidPublicKey).toBe('public-key');
  });

  it('rejects an invalid subscription with 400', async () => {
    buildApp({
      PUSH_SPIKE_ENABLED: 'true',
      PUSH_COMPONENT_JID: 'push.galena.localhost',
    });
    clientIp = '10.9.0.13';
    const cookie = await signUp('spike-bad@example.com', clientIp);
    const res = await app.request(`${BASE_URL}/api/push-spike/subscribe`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'not-a-url', keys: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('requires a session for the config endpoint', async () => {
    buildApp({
      PUSH_SPIKE_ENABLED: 'true',
      PUSH_COMPONENT_JID: 'push.galena.localhost',
      PUSH_VAPID_PUBLIC_KEY: 'public-key',
    });
    const res = await app.request(`${BASE_URL}/api/push-spike/config`);
    expect(res.status).toBe(401);
  });
});
