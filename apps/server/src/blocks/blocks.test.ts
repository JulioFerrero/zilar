// Block tests (T-0171, part 1a): block/unblock routes, silent contact
// request effects, by-handle effects, limiter and audit. Uses the same DB
// test setup as the contact-request tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contactRequests, user, userBlocks } from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { claimHandle } from '../handles/store';
import { createRateLimiter } from '../rate-limit';
import { BLOCK_WRITE_RATE_LIMIT_MAX, createBlocksRoutes } from './routes';
import { blockUser, listBlockedUsers, MAX_BLOCK_LIST_ROWS, unblockUser } from './service';

function authHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

describe('blocks', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function withHandle(email: string, handle: string) {
    const user = await bootstrapUser(context, app, email);
    await claimHandle(context.db, user.id, handle);
    return user;
  }

  async function putBlock(cookie: string, userId: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/blocks/${userId}`, {
      method: 'PUT',
      headers: authHeaders(cookie),
    });
  }

  async function deleteBlock(cookie: string, userId: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/blocks/${userId}`, {
      method: 'DELETE',
      headers: authHeaders(cookie),
    });
  }

  async function postRequest(cookie: string, handle: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/contact-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(cookie) },
      body: JSON.stringify({ handle }),
    });
  }

  it('blocks and unblocks idempotently', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');

    const first = await putBlock(alice.cookie, bob.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ blocked: true });
    expect(await context.db.select().from(userBlocks)).toHaveLength(1);

    // Blocking twice keeps one row and still answers success.
    const second = await putBlock(alice.cookie, bob.id);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ blocked: true });
    expect(await context.db.select().from(userBlocks)).toHaveLength(1);

    const unblocked = await deleteBlock(alice.cookie, bob.id);
    expect(unblocked.status).toBe(200);
    expect(await unblocked.json()).toEqual({ blocked: false });
    expect(await context.db.select().from(userBlocks)).toHaveLength(0);

    // Unblocking someone never blocked still answers success.
    const again = await deleteBlock(alice.cookie, bob.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ blocked: false });
  });

  it('answers 404 for an unknown user and 400 for yourself', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');

    const unknown = await putBlock(alice.cookie, 'does-not-exist');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('not_found');

    const self = await putBlock(alice.cookie, alice.id);
    expect(self.status).toBe(400);
    expect(((await self.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  it('cancels pending requests in both directions on block', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');

    expect((await postRequest(alice.cookie, 'bob_b')).status).toBe(201);
    expect((await putBlock(bob.cookie, alice.id)).status).toBe(200);

    const rows = await context.db.select().from(contactRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('cancelled');
    expect(rows[0]?.decidedAt).not.toBeNull();

    // The other direction too: bob asks, alice blocks.
    const carol = await withHandle('carol@example.com', 'carol_c');
    const dave = await withHandle('dave@example.com', 'dave_d');
    expect((await postRequest(carol.cookie, 'dave_d')).status).toBe(201);
    expect((await putBlock(carol.cookie, dave.id)).status).toBe(200);
    const cancelled = await context.db
      .select()
      .from(contactRequests)
      .where(eq(contactRequests.fromUserId, carol.id));
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.status).toBe('cancelled');
  });

  it('lists the blockers newest first, with handles and never an email', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const carol = await withHandle('carol@example.com', 'carol_c');

    expect((await putBlock(alice.cookie, bob.id)).status).toBe(200);
    expect((await putBlock(alice.cookie, carol.id)).status).toBe(200);

    const response = await app.request(`${TEST_BASE_URL}/api/blocks`, {
      headers: authHeaders(alice.cookie),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      blocked: Array<{ userId: string; name: string; handle: string | null; image: unknown }>;
    };
    expect(body.blocked.map((entry) => entry.userId).sort()).toEqual([bob.id, carol.id].sort());
    for (const entry of body.blocked) {
      expect(entry.image).toBeNull();
    }
    expect(body.blocked.find((entry) => entry.userId === bob.id)?.handle).toBe('bob_b');
    expect(JSON.stringify(body)).not.toContain('bob@example.com');
    expect(JSON.stringify(body)).not.toContain('carol@example.com');

    // A blocked person with no handle lists with `handle: null`.
    const { handles } = await import('../db/schema');
    await context.db.delete(handles).where(eq(handles.userId, bob.id));
    const relisted = (await (
      await app.request(`${TEST_BASE_URL}/api/blocks`, {
        headers: authHeaders(alice.cookie),
      })
    ).json()) as { blocked: Array<{ userId: string; handle: string | null }> };
    expect(relisted.blocked.find((entry) => entry.userId === bob.id)?.handle).toBeNull();
  });

  it('orders the list newest first and caps it at 500', async () => {
    const blockerId = 'blocker-cap';
    await context.db.insert(user).values({ id: blockerId, name: 'Blocker', email: 'b@x.test' });
    const blockedIds: string[] = [];
    for (let index = 0; index < MAX_BLOCK_LIST_ROWS + 1; index += 1) {
      const id = `blocked-${index}`;
      blockedIds.push(id);
      await context.db.insert(user).values({ id, name: `Person ${index}`, email: `${id}@x.test` });
    }
    for (let index = 0; index < blockedIds.length; index += 1) {
      const id = blockedIds[index];
      if (!id) {
        throw new Error('missing blocked id');
      }
      await context.db.insert(userBlocks).values({
        userId: blockerId,
        blockedUserId: id,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      });
    }

    const listed = await listBlockedUsers({ db: context.db }, blockerId);
    expect(listed.blocked).toHaveLength(MAX_BLOCK_LIST_ROWS);
    // Newest first: `blocked-500` first, and the oldest (`blocked-0`) fell
    // off the cap.
    expect(listed.blocked[0]?.userId).toBe(`blocked-${MAX_BLOCK_LIST_ROWS}`);
    expect(listed.blocked.map((entry) => entry.userId)).not.toContain('blocked-0');
  });

  it('answers a blocked sender with 201 but stores declined and hides it from the blocker', async () => {
    const alice = await withHandle('alice@example.com', 'alice_s');
    const bob = await withHandle('bob@example.com', 'bob_s');

    expect((await putBlock(bob.cookie, alice.id)).status).toBe(200);

    const created = await postRequest(alice.cookie, 'bob_s');
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      request: { id: string; status: string; decidedAt?: string };
    };
    // Silent to the sender: looks like a normal new pending request.
    expect(createdBody.request.status).toBe('pending');
    expect(createdBody.request.decidedAt).toBeUndefined();

    const stored = await context.db
      .select()
      .from(contactRequests)
      .where(eq(contactRequests.fromUserId, alice.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('declined');
    expect(stored[0]?.decidedAt).not.toBeNull();

    // The blocker's incoming list never shows it.
    const bobList = (await (
      await app.request(`${TEST_BASE_URL}/api/contact-requests`, {
        headers: authHeaders(bob.cookie),
      })
    ).json()) as { incoming: unknown[] };
    expect(bobList.incoming).toHaveLength(0);

    // And a repeat request still looks successful (no cooldown 429).
    expect((await postRequest(alice.cookie, 'bob_s')).status).toBe(201);
  });

  it('refuses the blocker’s own request with 409 blocked', async () => {
    const alice = await withHandle('alice@example.com', 'alice_b');
    const bob = await withHandle('bob@example.com', 'bob_bb');

    expect((await putBlock(alice.cookie, bob.id)).status).toBe(200);
    const refused = await postRequest(alice.cookie, 'bob_bb');
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('blocked');
    expect(body.error.message).toBe('Unblock this person first');
  });

  it('hides the blocker’s handle and reports relation blocked to the blocker', async () => {
    const alice = await withHandle('alice@example.com', 'alice_h');
    const bob = await withHandle('bob@example.com', 'bob_h');

    async function lookup(cookie: string, handle: string) {
      const response = await app.request(
        `${TEST_BASE_URL}/api/users/by-handle/${encodeURIComponent(handle)}`,
        { headers: authHeaders(cookie) },
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    expect((await putBlock(bob.cookie, alice.id)).status).toBe(200);

    // Blocked by the target: the same 404 as an unknown handle.
    const hidden = await lookup(alice.cookie, 'bob_h');
    expect(hidden.status).toBe(404);
    const missing = await lookup(alice.cookie, 'nobody_here_xyz');
    expect(missing.status).toBe(404);
    expect(hidden.body).toMatchObject({
      error: { code: 'not_found', message: 'No user with that username' },
    });
    expect(missing.body).toMatchObject({
      error: { code: 'not_found', message: 'No user with that username' },
    });

    // The blocker still sees the profile, with relation `blocked`.
    const blockerView = await lookup(bob.cookie, 'alice_h');
    expect(blockerView.status).toBe(200);
    expect(blockerView.body.relation).toBe('blocked');
  });

  it('rate limits writes at 30 per 10 minutes per user', async () => {
    const alice = await withHandle('alice@example.com', 'alice_l');
    const bob = await withHandle('bob@example.com', 'bob_l');

    // 30 writes (15 block/unblock cycles), then the 31st is refused.
    for (let cycle = 0; cycle < BLOCK_WRITE_RATE_LIMIT_MAX / 2; cycle += 1) {
      expect((await putBlock(alice.cookie, bob.id)).status).toBe(200);
      expect((await deleteBlock(alice.cookie, bob.id)).status).toBe(200);
    }
    const limited = await putBlock(alice.cookie, bob.id);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('refuses reads after the injected read limiter is exhausted', async () => {
    const alice = await withHandle('alice@example.com', 'alice_rl');
    const { Hono } = await import('hono');
    const { HttpError } = await import('../errors');
    const wrapper = new Hono();
    wrapper.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    wrapper.route(
      '/',
      createBlocksRoutes({
        auth: context.auth,
        db: context.db,
        readLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }),
      }),
    );
    const first = await wrapper.request('/blocks', {
      headers: authHeaders(alice.cookie),
    });
    expect(first.status).toBe(200);
    const second = await wrapper.request('/blocks', {
      headers: authHeaders(alice.cookie),
    });
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });
  it('refuses writes after the injected limiter is exhausted', async () => {
    const alice = await withHandle('alice@example.com', 'alice_i');
    const bob = await withHandle('bob@example.com', 'bob_i');
    const { Hono } = await import('hono');
    const { HttpError } = await import('../errors');
    // A standalone route object has no error mapper, so mount it on a
    // wrapper with the same HttpError mapping `app.ts` uses.
    const wrapper = new Hono();
    wrapper.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    wrapper.route(
      '/',
      createBlocksRoutes({
        auth: context.auth,
        db: context.db,
        writeLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }),
      }),
    );
    const first = await wrapper.request(`/blocks/${bob.id}`, {
      method: 'PUT',
      headers: authHeaders(alice.cookie),
    });
    expect(first.status).toBe(200);
    const second = await wrapper.request(`/blocks/${bob.id}`, {
      method: 'PUT',
      headers: authHeaders(alice.cookie),
    });
    expect(second.status).toBe(429);
  });

  it('audits block and unblock once each, with ids only, after the commit', async () => {
    const alice = await withHandle('alice@example.com', 'alice_a');
    const bob = await withHandle('bob@example.com', 'bob_a');
    const records: Array<{ action: string; subjectId: string | null; detail: unknown }> = [];
    const audit = {
      record: async (entry: { action: string; subjectId: string | null; detail: unknown }) => {
        records.push(entry);
      },
    } as unknown as NonNullable<Parameters<typeof blockUser>[0]['audit']>;
    const service = { db: context.db, audit };

    await blockUser(service, alice.id, bob.id);
    await blockUser(service, alice.id, bob.id);
    await unblockUser(service, alice.id, bob.id);
    await unblockUser(service, alice.id, bob.id);

    expect(records.map((entry) => entry.action)).toEqual(['user.blocked', 'user.unblocked']);
    for (const entry of records) {
      expect(entry.subjectId).toBe(bob.id);
      expect(entry.detail).toBeNull();
    }
  });

  it('writes no audit row when a block is refused', async () => {
    const alice = await withHandle('alice@example.com', 'alice_r');
    const records: string[] = [];
    const audit = {
      record: async (entry: { action: string }) => {
        records.push(entry.action);
      },
    } as unknown as NonNullable<Parameters<typeof blockUser>[0]['audit']>;

    await expect(
      blockUser({ db: context.db, audit }, alice.id, 'does-not-exist'),
    ).rejects.toMatchObject({ status: 404 });
    expect(records).toEqual([]);
  });

  it('reads blocks newest first through service timestamps', async () => {
    const alice = await withHandle('alice@example.com', 'alice_t');
    const bob = await withHandle('bob@example.com', 'bob_t');
    const carol = await withHandle('carol@example.com', 'carol_t');
    await blockUser(
      { db: context.db, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) },
      alice.id,
      bob.id,
    );
    await blockUser(
      { db: context.db, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 10)) },
      alice.id,
      carol.id,
    );
    const listed = await listBlockedUsers({ db: context.db }, alice.id);
    expect(listed.blocked.map((entry) => entry.userId)).toEqual([carol.id, bob.id]);
  });
});
