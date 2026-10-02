import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contacts } from '../db/schema';
import { handles, retiredHandles } from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { checkHandleAvailability, claimHandle, HANDLE_CHANGE_INTERVAL_DAYS } from './store';

function authHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

describe('handles', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function setHandle(cookie: string, handle: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders(cookie) },
      body: JSON.stringify({ handle }),
    });
  }

  it('claims through PUT /api/me/handle and reads back on GET /api/me', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');

    const response = await setHandle(alice.cookie, 'Ada');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: 'Ada' });

    const me = await app.request(`${TEST_BASE_URL}/api/me`, {
      headers: authHeaders(alice.cookie),
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { handle: string | null }).handle).toBe('Ada');
  });

  it('maps invalid/reserved/taken through the check endpoint with reasons', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    expect((await setHandle(alice.cookie, 'Ada')).status).toBe(200);

    async function check(cookie: string, handle: string) {
      const response = await app.request(
        `${TEST_BASE_URL}/api/handles/check?handle=${encodeURIComponent(handle)}`,
        { headers: authHeaders(cookie) },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { available: boolean; reason?: string };
    }

    expect(await check(bob.cookie, 'ab')).toEqual({ available: false, reason: 'invalid' });
    expect(await check(bob.cookie, 'admin')).toEqual({ available: false, reason: 'reserved' });
    expect(await check(bob.cookie, 'ADA')).toEqual({ available: false, reason: 'taken' });
    expect(await check(bob.cookie, 'bob_new')).toEqual({ available: true });
  });

  it('refuses a change within 14 days with nextChangeAt', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    expect((await setHandle(alice.cookie, 'ada')).status).toBe(200);

    const second = await setHandle(alice.cookie, 'ada2');
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('handle_change_too_soon');
    expect(body.error.message).toMatch(/20\d\d/);
  });

  it('reserves the old handle for 30 days for its former owner only', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    expect((await setHandle(alice.cookie, 'ada_old')).status).toBe(200);

    // Backdate the change so a new claim is allowed.
    const rows = await context.db.select().from(handles).where(eq(handles.userId, alice.id));
    expect(rows).toHaveLength(1);
    await context.db
      .update(handles)
      .set({ changedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(handles.userId, alice.id));

    expect((await setHandle(alice.cookie, 'ada_new')).status).toBe(200);

    const retired = await context.db.select().from(retiredHandles);
    expect(retired).toHaveLength(1);
    expect(retired[0]?.formerUserId).toBe(alice.id);

    // Another user cannot take it while reserved.
    const taken = await setHandle(bob.cookie, 'ada_old');
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('handle_taken');

    // The former owner may reclaim it.
    await context.db
      .update(handles)
      .set({ changedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(handles.userId, alice.id));
    expect((await setHandle(alice.cookie, 'ada_old')).status).toBe(200);
  });

  it('lets exactly one concurrent claim win', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');

    const results = await Promise.allSettled([
      claimHandle(context.db, alice.id, 'race_handle'),
      claimHandle(context.db, bob.id, 'RACE_handle'),
    ]);
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = (lost[0] as PromiseRejectedResult).reason as { code?: string };
    expect(reason.code).toBe('handle_taken');
  });

  it('counts retired-by-me as available on check but taken for others', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    expect((await setHandle(alice.cookie, 'mine_once')).status).toBe(200);
    await context.db
      .update(handles)
      .set({ changedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(handles.userId, alice.id));
    expect((await setHandle(alice.cookie, 'mine_now')).status).toBe(200);

    expect(await checkHandleAvailability(context.db, alice.id, 'mine_once')).toEqual({
      available: true,
    });
    expect(await checkHandleAvailability(context.db, bob.id, 'mine_once')).toEqual({
      available: false,
      reason: 'taken',
    });
  });

  it('rate limits the check endpoint', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    let limited = 0;
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await app.request(
        `${TEST_BASE_URL}/api/handles/check?handle=probe${attempt}`,
        { headers: authHeaders(alice.cookie) },
      );
      if (response.status === 429) {
        limited += 1;
      }
      await response.text();
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('requires a session on the handle routes', async () => {
    expect((await app.request(`${TEST_BASE_URL}/api/handles/check?handle=ada`)).status).toBe(401);
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/me/handle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle: 'ada' }),
        })
      ).status,
    ).toBe(401);
  });

  it('returns no email on the handle check endpoint', async () => {
    const alice = await bootstrapUser(context, app, 'leakcheck@example.com');
    expect((await setHandle(alice.cookie, 'leak_free')).status).toBe(200);
    const check = await app.request(`${TEST_BASE_URL}/api/handles/check?handle=Leak_Free`, {
      headers: authHeaders(alice.cookie),
    });
    expect(check.status).toBe(200);
    const payload = JSON.stringify(await check.json());
    expect(payload).not.toContain('leakcheck');
    expect(payload).toContain('taken');
  });

  it(`change interval is ${HANDLE_CHANGE_INTERVAL_DAYS} days from the stored timestamp`, async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    await claimHandle(context.db, alice.id, 'interval_one');
    await expect(claimHandle(context.db, alice.id, 'interval_two')).rejects.toMatchObject({
      code: 'handle_change_too_soon',
    });
    expect(await context.db.select().from(contacts)).toHaveLength(0);
  });
});
