import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contacts } from '../db/schema';
import { contactRequests } from '../db/schema';
import { UNNAMED_CONTACT_NAME } from '../contacts/service';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { claimHandle } from '../handles/store';

function authHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

describe('contact requests', () => {
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
    return { ...user, email };
  }

  async function postRequest(cookie: string, handle: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/contact-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(cookie) },
      body: JSON.stringify({ handle }),
    });
  }

  it('creates a pending request, lists it both sides, and accepts into mutual contacts', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');

    const created = await postRequest(alice.cookie, 'BOB_B');
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      request: { id: string; fromUserId: string; toUserId: string; status: string };
    };
    expect(createdBody.request.fromUserId).toBe(alice.id);
    expect(createdBody.request.toUserId).toBe(bob.id);
    expect(createdBody.request.status).toBe('pending');

    const bobList = (await (
      await app.request(`${TEST_BASE_URL}/api/contact-requests`, {
        headers: authHeaders(bob.cookie),
      })
    ).json()) as {
      incoming: Array<{ id: string; other: Record<string, unknown> }>;
      outgoing: unknown[];
    };
    expect(bobList.incoming).toHaveLength(1);
    expect(bobList.incoming[0]?.id).toBe(createdBody.request.id);
    expect(bobList.incoming[0]?.other).toMatchObject({
      userId: alice.id,
      handle: 'alice_w',
    });
    expect(JSON.stringify(bobList)).not.toContain('alice@example.com');
    expect(bobList.outgoing).toHaveLength(0);

    const accept = await app.request(
      `${TEST_BASE_URL}/api/contact-requests/${createdBody.request.id}/accept`,
      { method: 'POST', headers: authHeaders(bob.cookie) },
    );
    expect(accept.status).toBe(200);

    const rows = await context.db.select().from(contacts);
    expect(rows.map((row) => `${row.userId}->${row.contactUserId}`).sort()).toEqual(
      [`${alice.id}->${bob.id}`, `${bob.id}->${alice.id}`].sort(),
    );
    expect(rows.every((row) => row.source === 'manual' && row.rosterSynced)).toBe(true);
    expect(context.adminClient.rosterItems).toHaveLength(2);

    // Double accept changes nothing.
    const again = await app.request(
      `${TEST_BASE_URL}/api/contact-requests/${createdBody.request.id}/accept`,
      { method: 'POST', headers: authHeaders(bob.cookie) },
    );
    expect(again.status).toBe(200);
    expect((await context.db.select().from(contacts)).length).toBe(2);
  });

  it('refuses self, existing contact, duplicates, and reverse duplicates', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');

    const self = await postRequest(alice.cookie, 'alice_w');
    expect(self.status).toBe(400);

    expect((await postRequest(alice.cookie, 'bob_b')).status).toBe(201);
    const duplicate = await postRequest(alice.cookie, 'BOB_B');
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
      'request_exists',
    );

    // The reverse direction answers 200 with the existing request for
    // "Accept" — and exactly one row exists.
    const reverse = await postRequest(bob.cookie, 'alice_w');
    expect(reverse.status).toBe(200);
    const reverseBody = (await reverse.json()) as {
      request: { id: string; fromUserId: string; toUserId: string };
      incoming: boolean;
    };
    expect(reverseBody.incoming).toBe(true);
    expect(reverseBody.request.fromUserId).toBe(alice.id);
    expect(reverseBody.request.toUserId).toBe(bob.id);
    expect((await context.db.select().from(contactRequests)).length).toBe(1);
  });

  it('creates exactly one pending row for simultaneous opposite-direction requests', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const { createContactRequest } = await import('./service');
    const db = context.db;
    const [aResult, bResult] = await Promise.allSettled([
      createContactRequest({ db }, alice.id, 'bob_b'),
      createContactRequest({ db }, bob.id, 'alice_w'),
    ]);
    const rows = await context.db.select().from(contactRequests);
    expect(rows).toHaveLength(1);
    const fulfilled = [aResult, bResult].filter((r) => r.status === 'fulfilled');
    const rejected = [aResult, bResult].filter((r) => r.status === 'rejected');
    // Exactly one direction wins the insert; the loser either got the
    // reverse row back (200-style, no throw) or hit `request_exists` on the
    // same-direction backstop. No other outcome is possible. (On PGlite the
    // two txs serialize on one connection so the loser takes the normal
    // reverse path; on real Postgres the loser takes the recovery path
    // below — both end with exactly one row.)
    expect(fulfilled.length + rejected.length).toBe(2);
    for (const result of fulfilled) {
      const value = (result as PromiseFulfilledResult<{ request: { id: string } }>).value;
      expect(value.request.id).toBe(rows[0]?.id);
    }
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        code: 'request_exists',
      });
    }
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it('recovers outside the aborted tx when the insert hits the pair index', async () => {
    // Real Postgres aborts the transaction on a unique violation, so the
    // recovery reads must run on a fresh connection, never on the aborted
    // tx. PGlite serializes on one connection and cannot reproduce the race;
    // instead `onInsert` throws the real effect/sql `UniqueViolation` for the
    // pair index. `onRecovery` fires at the recovery seam, once the
    // transaction has rolled back and released the connection: it commits the
    // concurrent winner that landed between the pre-check and the insert, and
    // records that the recovery reads start there.
    const { SqlError } = await import('effect/sql');
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const service = await import('./service');
    const { createContactRequest, isPendingPairViolation } = service;

    const winnerId = 'winner-reverse-row';
    const seams: string[] = [];

    const recovered = await createContactRequest(
      {
        db: context.db,
        onInsert: () => {
          seams.push('insert');
          throw new SqlError.SqlError({
            reason: new SqlError.UniqueViolation({
              cause: new Error('simulated concurrent insert'),
              constraint: 'contact_requests_pending_pair_idx',
            }),
          });
        },
        onRecovery: async () => {
          // The transaction already rolled back, so this insert on the outer
          // connection commits: the winner the aborted tx never saw. If the
          // recovery had run inside the aborted tx, this insert would fail or
          // be rolled back with it.
          await context.db.insert(contactRequests).values({
            id: winnerId,
            fromUserId: bob.id,
            toUserId: alice.id,
            status: 'pending',
            createdAt: new Date(),
          });
          seams.push('recovery');
        },
      },
      alice.id,
      'bob_b',
    );

    // The reverse-direction loser gets the winner's row back (200-style).
    expect(recovered.request.id).toBe(winnerId);
    expect(recovered.reverseOf?.id).toBe(winnerId);
    // The insert ran inside the transaction (the seam threw there); recovery
    // ran afterwards at the seam, on the fresh connection.
    expect(seams).toEqual(['insert', 'recovery']);
    expect(isPendingPairViolation({ code: '23505' })).toBe(true);
    expect(
      isPendingPairViolation({ code: '23505', constraint: 'contact_requests_pending_idx' }),
    ).toBe(true);
    expect(
      isPendingPairViolation({ code: '23505', constraint: 'contact_requests_pending_pair_idx' }),
    ).toBe(true);
    expect(isPendingPairViolation({ code: '23505', constraint: 'some_other_index' })).toBe(false);
    expect(isPendingPairViolation(new Error('boom'))).toBe(false);
    // The effect/sql shape is matched through the structured reason, too.
    const violation = (constraint: string) =>
      new SqlError.SqlError({
        reason: new SqlError.UniqueViolation({
          cause: new Error('simulated'),
          constraint,
        }),
      });
    expect(isPendingPairViolation(violation('contact_requests_pending_idx'))).toBe(true);
    expect(isPendingPairViolation(violation('contact_requests_pending_pair_idx'))).toBe(true);
    expect(isPendingPairViolation(violation('some_other_index'))).toBe(false);
    // The winner row survived the rollback and is the only pending row left.
    const rows = await context.db.select().from(contactRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(winnerId);
  });

  it('declines, cancels, and cools down re-requests for 7 days', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    await withHandle('carol@example.com', 'carol_c');

    const created = await postRequest(alice.cookie, 'bob_b');
    expect(created.status).toBe(201);
    const { request: direct } = (await created.json()) as { request: { id: string } };

    const decline = await app.request(
      `${TEST_BASE_URL}/api/contact-requests/${direct.id}/decline`,
      { method: 'POST', headers: authHeaders(bob.cookie) },
    );
    expect(decline.status).toBe(200);

    // A re-request within 7 days of the decline is refused (429
    // `declined_recently`); after the cooldown passes it succeeds again.
    const cooled = await postRequest(alice.cookie, 'bob_b');
    expect(cooled.status).toBe(429);
    expect(((await cooled.json()) as { error: { code: string } }).error.code).toBe(
      'declined_recently',
    );
    await context.db
      .update(contactRequests)
      .set({ decidedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(contactRequests.fromUserId, alice.id));
    expect((await postRequest(alice.cookie, 'bob_b')).status).toBe(201);

    const toCarol = (await (await postRequest(alice.cookie, 'carol_c')).json()) as {
      request: { id: string };
    };
    const cancel = await app.request(
      `${TEST_BASE_URL}/api/contact-requests/${toCarol.request.id}`,
      { method: 'DELETE', headers: authHeaders(alice.cookie) },
    );
    expect(cancel.status).toBe(200);
    // A cancelled request may be re-sent at once.
    expect((await postRequest(alice.cookie, 'carol_c')).status).toBe(201);
  });

  it('caps pending outgoing at 20, atomically per sender', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const { createContactRequest } = await import('./service');
    const service = { db: context.db };
    for (let index = 0; index < 19; index += 1) {
      await withHandle(`target${index}@example.com`, `target_${index}`);
      expect((await postRequest(alice.cookie, `target_${index}`)).status).toBe(201);
    }
    // At 19 pending, two concurrent creates to different targets serialize
    // on the per-sender lock: exactly one wins, the other hits the cap.
    await Promise.all([
      withHandle('extra-a@example.com', 'extra_aaa'),
      withHandle('extra-b@example.com', 'extra_bbb'),
    ]);
    const results = await Promise.allSettled([
      createContactRequest(service, alice.id, 'extra_aaa'),
      createContactRequest(service, alice.id, 'extra_bbb'),
    ]);
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'too_many_requests',
    });

    // And one more serial create also hits the cap.
    await withHandle('extra@example.com', 'extra_one');
    const capped = await postRequest(alice.cookie, 'extra_one');
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: { code: string } }).error.code).toBe(
      'too_many_requests',
    );
  });

  it('answers unknown and retired handles with the same 404', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const missing = await postRequest(alice.cookie, 'nobody_here_xyz');
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: { code: string; message: string } };

    const bob = await withHandle('bob@example.com', 'bob_retired');
    // Retire bob's handle by backdating and moving to a new one.
    const { handles } = await import('../db/schema');
    await context.db
      .update(handles)
      .set({ changedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(handles.userId, bob.id));
    await claimHandle(context.db, bob.id, 'bob_now');
    const retired = await postRequest(alice.cookie, 'bob_retired');
    expect(retired.status).toBe(404);
    const retiredBody = (await retired.json()) as { error: { code: string; message: string } };
    // Same status, same code, same message — only the per-request id differs.
    expect(retiredBody.error.code).toBe(missingBody.error.code);
    expect(retiredBody.error.message).toBe(missingBody.error.message);
  });

  it('answers not-actable and unknown ids with the same 404', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const carol = await withHandle('carol@example.com', 'carol_c');

    const created = (await (await postRequest(alice.cookie, 'bob_b')).json()) as {
      request: { id: string };
    };
    // The sender cannot accept their own request; a stranger cannot decline.
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/contact-requests/${created.request.id}/accept`, {
          method: 'POST',
          headers: authHeaders(alice.cookie),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/contact-requests/${created.request.id}/decline`, {
          method: 'POST',
          headers: authHeaders(carol.cookie),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/contact-requests/does-not-exist/accept`, {
          method: 'POST',
          headers: authHeaders(bob.cookie),
        })
      ).status,
    ).toBe(404);
  });

  it('resolves by-handle with relation and never an email', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');

    async function lookup(cookie: string, handle: string) {
      const response = await app.request(
        `${TEST_BASE_URL}/api/users/by-handle/${encodeURIComponent(handle)}`,
        { headers: authHeaders(cookie) },
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    const stranger = await lookup(alice.cookie, 'BOB_B');
    expect(stranger.status).toBe(200);
    expect(stranger.body).toMatchObject({ handle: 'bob_b', relation: 'none' });
    expect(JSON.stringify(stranger.body)).not.toContain('bob@example.com');

    expect((await postRequest(alice.cookie, 'bob_b')).status).toBe(201);
    expect((await lookup(alice.cookie, 'bob_b')).body.relation).toBe('request_sent');
    expect((await lookup(bob.cookie, 'alice_w')).body.relation).toBe('request_received');
    expect((await lookup(alice.cookie, 'alice_w')).body.relation).toBe('self');

    expect((await lookup(alice.cookie, 'missing_handle_xyz')).status).toBe(404);
  });

  it('accepts through the reverse-request flow without two rows', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    expect((await postRequest(alice.cookie, 'bob_b')).status).toBe(201);
    const reverseResponse = await postRequest(bob.cookie, 'alice_w');
    expect(reverseResponse.status).toBe(200);
    const reverse = (await reverseResponse.json()) as {
      request: { id: string };
      incoming: boolean;
    };
    expect(reverse.incoming).toBe(true);
    const accept = await app.request(
      `${TEST_BASE_URL}/api/contact-requests/${reverse.request.id}/accept`,
      { method: 'POST', headers: authHeaders(bob.cookie) },
    );
    expect(accept.status).toBe(200);
    expect((await context.db.select().from(contacts)).length).toBe(2);
  });

  it('retries roster sync like invites when ejabberd is down', async () => {
    const { FakeAdminClient } = await import('../test-support');
    const adminClient = new FakeAdminClient();
    adminClient.failRoster = true;
    const failing = await createTestContext({ adminClient });
    try {
      const failingApp = testApp(failing);
      const { bootstrapUser: boot } = await import('../test-support');
      const { claimHandle: claim } = await import('../handles/store');
      const alice = await boot(failing, failingApp, 'alice@example.com');
      const bob = await boot(failing, failingApp, 'bob@example.com');
      await claim(failing.db, alice.id, 'alice_w');
      await claim(failing.db, bob.id, 'bob_b');

      const created = await failingApp.request(`${TEST_BASE_URL}/api/contact-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ handle: 'bob_b' }),
      });
      expect(created.status).toBe(201);
      const { request } = (await created.json()) as { request: { id: string } };
      const accept = await failingApp.request(
        `${TEST_BASE_URL}/api/contact-requests/${request.id}/accept`,
        { method: 'POST', headers: { cookie: bob.cookie } },
      );
      expect(accept.status).toBe(200);
      expect(adminClient.rosterItems).toHaveLength(0);
      const rows = await failing.db.select().from(contacts);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => !row.rosterSynced)).toBe(true);

      adminClient.failRoster = false;
      const token = await failingApp.request(`${TEST_BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie: bob.cookie },
      });
      expect(token.status).toBe(200);
      expect(adminClient.rosterItems).toHaveLength(1);
      expect(adminClient.rosterItems[0]).toMatchObject({
        localpart: localpartFor(bob.id),
        contactJid: `${localpartFor(alice.id)}@zilar.localhost`,
      });
      expect(UNNAMED_CONTACT_NAME).toBe('Unnamed user');
    } finally {
      await failing.close();
    }
  });

  it('lists newest first and requires a session', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const unauthenticated = await app.request(`${TEST_BASE_URL}/api/contact-requests`);
    expect(unauthenticated.status).toBe(401);

    const first = await withHandle('first@example.com', 'first_one');
    const second = await withHandle('second@example.com', 'second_one');
    expect((await postRequest(alice.cookie, 'first_one')).status).toBe(201);
    expect((await postRequest(alice.cookie, 'second_one')).status).toBe(201);
    const list = (await (
      await app.request(`${TEST_BASE_URL}/api/contact-requests`, {
        headers: authHeaders(alice.cookie),
      })
    ).json()) as { outgoing: Array<{ other: { handle: string }; createdAt: string }> };
    // Seed order is first-then-second; the list is newest-first regardless.
    expect(list.outgoing.map((entry) => entry.other.handle)).toEqual(['second_one', 'first_one']);
    expect(
      Date.parse(list.outgoing[0]?.createdAt ?? '') >=
        Date.parse(list.outgoing[1]?.createdAt ?? ''),
    ).toBe(true);
    expect([first.email, second.email].sort()).toEqual(['first@example.com', 'second@example.com']);
  });

  it('a re-accept repairs a half-finished accept', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const created = await postRequest(alice.cookie, 'bob_b');
    expect(created.status).toBe(201);
    const { request } = (await created.json()) as { request: { id: string } };

    const accept = await app.request(`${TEST_BASE_URL}/api/contact-requests/${request.id}/accept`, {
      method: 'POST',
      headers: authHeaders(bob.cookie),
    });
    expect(accept.status).toBe(200);

    // Simulate the crash between the flip and the pair write: the row says
    // accepted but the contacts are gone.
    await context.db.delete(contacts);
    expect(await context.db.select().from(contacts)).toHaveLength(0);

    const repair = await app.request(`${TEST_BASE_URL}/api/contact-requests/${request.id}/accept`, {
      method: 'POST',
      headers: authHeaders(bob.cookie),
    });
    expect(repair.status).toBe(200);
    const rows = await context.db.select().from(contacts);
    expect(rows.map((row) => `${row.userId}->${row.contactUserId}`).sort()).toEqual(
      [`${alice.id}->${bob.id}`, `${bob.id}->${alice.id}`].sort(),
    );
  });

  it('audits create and accept once each, with ids only, after the commit', async () => {
    const alice = await withHandle('alice@example.com', 'alice_a');
    const bob = await withHandle('bob@example.com', 'bob_audit');
    const { createContactRequest, acceptContactRequest } = await import('./service');
    const records: Array<{ action: string; subjectId: string | null; detail: unknown }> = [];
    const audit = {
      record: async (entry: { action: string; subjectId: string | null; detail: unknown }) => {
        records.push(entry);
      },
    } as unknown as NonNullable<Parameters<typeof createContactRequest>[0]['audit']>;
    const service = { db: context.db, audit };

    const { request } = await createContactRequest(service, alice.id, 'bob_audit');
    await acceptContactRequest(service, request.id, bob.id);
    await acceptContactRequest(service, request.id, bob.id);

    expect(records.map((entry) => entry.action)).toEqual([
      'contact_request.created',
      'contact_request.accepted',
    ]);
    for (const entry of records) {
      expect(entry.subjectId).toBe(request.id);
      expect(entry.detail).toBeNull();
    }
  });

  it('writes no audit row when a create is refused', async () => {
    const alice = await withHandle('alice@example.com', 'alice_r');
    const { createContactRequest } = await import('./service');
    const records: string[] = [];
    const audit = {
      record: async (entry: { action: string }) => {
        records.push(entry.action);
      },
    } as unknown as NonNullable<Parameters<typeof createContactRequest>[0]['audit']>;

    await expect(
      createContactRequest({ db: context.db, audit }, alice.id, 'nobody_here'),
    ).rejects.toMatchObject({ status: 404 });
    expect(records).toEqual([]);
  });
});
