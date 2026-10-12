import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { bootstrapUser, createTestContext, testSql, type TestContext } from '../test-support';

// T-1261: the account-deletion grace (T-A). These cover the request, the
// cancel, the fresh-session gate and the per-user scoping. The deletion job
// itself is a later task; nothing here deletes a user.

const BASE_URL = 'http://localhost:3000';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SLACK_MS = 5000;

type TestApp = ReturnType<typeof createApp>;

interface DeletionBody {
  scheduled: boolean;
  deleteAfter?: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

let clientIp = '10.2.0.1';

function appFor(context: TestContext): TestApp {
  return createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
  });
}

async function signIn(context: TestContext, app: TestApp, email: string): Promise<string> {
  await app.request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const otp = context.mailer.codeFor(email);
  const response = await app.request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
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

function postDeletion(app: TestApp, cookie: string): Promise<Response> {
  return app.request(`${BASE_URL}/api/me/deletion`, {
    method: 'POST',
    headers: { cookie, 'x-forwarded-for': clientIp },
  });
}

function deleteDeletion(app: TestApp, cookie: string): Promise<Response> {
  return app.request(`${BASE_URL}/api/me/deletion`, {
    method: 'DELETE',
    headers: { cookie, 'x-forwarded-for': clientIp },
  });
}

async function getDeletion(app: TestApp, cookie: string): Promise<DeletionBody> {
  const response = await app.request(`${BASE_URL}/api/me/deletion`, {
    headers: { cookie, 'x-forwarded-for': clientIp },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as DeletionBody;
}

describe('/api/me/deletion', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    clientIp = `10.2.0.${testCounter}`;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('schedules about seven days ahead and a second POST keeps the date', async () => {
    const app = appFor(context);
    const user = await bootstrapUser(context, app, 'a@example.com');
    const before = Date.now();

    const first = await postDeletion(app, user.cookie);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as DeletionBody;
    expect(firstBody.scheduled).toBe(true);
    const deleteAfter = new Date(firstBody.deleteAfter ?? '').getTime();
    expect(deleteAfter).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - CLOCK_SLACK_MS);
    expect(deleteAfter).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS + CLOCK_SLACK_MS);

    const second = await postDeletion(app, user.cookie);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as DeletionBody;
    expect(secondBody.deleteAfter).toBe(firstBody.deleteAfter);
  });

  it('cancels on DELETE and answers not scheduled, idempotently', async () => {
    const app = appFor(context);
    const user = await bootstrapUser(context, app, 'b@example.com');
    await postDeletion(app, user.cookie);

    const deleted = await deleteDeletion(app, user.cookie);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ scheduled: false });
    expect(await getDeletion(app, user.cookie)).toEqual({ scheduled: false });

    const again = await deleteDeletion(app, user.cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ scheduled: false });
  });

  it('answers 403 reauth_required for a session older than 30 minutes', async () => {
    const app = appFor(context);
    const user = await bootstrapUser(context, app, 'c@example.com');
    // Roll the session's creation into the past so it is no longer fresh. The
    // auth tables store a UTC wall clock in `timestamp` columns (see
    // `sessions.ts` and `sql-adapter.ts`), so write it the same way.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE "session" SET created_at = (now() AT TIME ZONE 'UTC') - interval '31 minutes' WHERE user_id = ${user.id}`;
      }),
    );

    const response = await postDeletion(app, user.cookie);
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('reauth_required');
    expect(body.error.message).toBe('Sign in again to delete your account.');
    expect(await getDeletion(app, user.cookie)).toEqual({ scheduled: false });
  });

  it('never touches another user row, and a sign-in cancels only the signer', async () => {
    const app = appFor(context);
    const alice = await bootstrapUser(context, app, 'd@example.com');
    const bob = await bootstrapUser(context, app, 'e@example.com');
    await postDeletion(app, alice.cookie);
    await postDeletion(app, bob.cookie);
    expect(await getDeletion(app, alice.cookie)).toMatchObject({ scheduled: true });
    expect(await getDeletion(app, bob.cookie)).toMatchObject({ scheduled: true });

    // A new sign-in as Alice cancels only Alice's request.
    const aliceAgain = await signIn(context, app, 'd@example.com');
    expect(await getDeletion(app, aliceAgain)).toEqual({ scheduled: false });
    expect(await getDeletion(app, bob.cookie)).toMatchObject({ scheduled: true });
  });
});
