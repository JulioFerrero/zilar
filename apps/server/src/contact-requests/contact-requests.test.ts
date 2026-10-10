import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { notFound } from './errors';
import {
  acceptContactRequest,
  cancelContactRequest,
  createContactRequest,
  declineContactRequest,
  MAX_PENDING_OUTGOING,
  type ContactRequestsDeps,
} from './service';

describe('contact request permissions (T-0994)', () => {
  let context: TestContext;
  let deps: ContactRequestsDeps;

  beforeEach(async () => {
    context = await createTestContext();
    deps = { db: context.db };
  });

  afterEach(async () => {
    await context.close();
  });

  // A live handle row for `userId`, so `createContactRequest` can resolve it.
  async function seedHandle(userId: string, handle: string): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO handles (handle_lower, handle, user_id)
          VALUES (${handle}, ${handle}, ${userId})`;
      }),
    );
  }

  // Three users A, B and C, each with a handle, and a pending request A -> B.
  async function seedRequest() {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    const c = await seedUser(context, { name: 'User C' });
    await seedHandle(a, 'user_a');
    await seedHandle(b, 'user_b');
    await seedHandle(c, 'user_c');
    const { request } = await createContactRequest(deps, a, 'user_b');
    return { a, b, c, request };
  }

  // The same 404 `notFound()` builds, so a rejected caller cannot tell the
  // request from an unknown id.
  function expectedNotFound() {
    const expected = notFound();
    return { status: expected.status, code: expected.code, message: expected.message };
  }

  it('lets only the recipient accept a request', async () => {
    const { a, b, c, request } = await seedRequest();

    await expect(acceptContactRequest(deps, request.id, a)).rejects.toMatchObject(
      expectedNotFound(),
    );
    await expect(acceptContactRequest(deps, request.id, c)).rejects.toMatchObject(
      expectedNotFound(),
    );

    const accepted = await acceptContactRequest(deps, request.id, b);
    expect(accepted.status).toBe('accepted');
  });

  it('lets only the recipient decline a request', async () => {
    const { a, b, c, request } = await seedRequest();

    await expect(declineContactRequest(deps, request.id, a)).rejects.toMatchObject(
      expectedNotFound(),
    );
    await expect(declineContactRequest(deps, request.id, c)).rejects.toMatchObject(
      expectedNotFound(),
    );

    const declined = await declineContactRequest(deps, request.id, b);
    expect(declined.status).toBe('declined');
  });

  it('lets only the sender cancel a request', async () => {
    const { a, b, c, request } = await seedRequest();

    await expect(cancelContactRequest(deps, request.id, b)).rejects.toMatchObject(
      expectedNotFound(),
    );
    await expect(cancelContactRequest(deps, request.id, c)).rejects.toMatchObject(
      expectedNotFound(),
    );

    const cancelled = await cancelContactRequest(deps, request.id, a);
    expect(cancelled.status).toBe('cancelled');
  });

  it('refuses a request to someone the sender blocked with 409 blocked', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await seedHandle(a, 'blocker_a');
    await seedHandle(b, 'blocked_b');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO user_blocks (user_id, blocked_user_id) VALUES (${a}, ${b})`;
      }),
    );

    await expect(createContactRequest(deps, a, 'blocked_b')).rejects.toMatchObject({
      status: 409,
      code: 'blocked',
    });
  });

  it('refuses a 21st pending outgoing request with 429 too_many_requests', async () => {
    const a = await seedUser(context, { name: 'User A' });
    await seedHandle(a, 'sender_a');
    const targets: string[] = [];
    for (let index = 0; index < MAX_PENDING_OUTGOING; index += 1) {
      const target = await seedUser(context, { name: `Target ${index}` });
      await seedHandle(target, `target_${index}`);
      targets.push(target);
    }
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO contact_requests ${sql.insert(
          targets.map((toUserId) => ({
            id: randomUUID(),
            from_user_id: a,
            to_user_id: toUserId,
            status: 'pending',
          })),
        )}`;
      }),
    );

    const overflow = await seedUser(context, { name: 'Overflow' });
    await seedHandle(overflow, 'overflow_x');

    await expect(createContactRequest(deps, a, 'overflow_x')).rejects.toMatchObject({
      status: 429,
      code: 'too_many_requests',
    });
  });
});
