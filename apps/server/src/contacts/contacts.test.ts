import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, expectedJid, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { acceptContactRequest } from '../contact-requests/api';
import { localpartFor } from '../xmpp/provisioning';
import * as sqlModule from '../effect/sql';
import { addContactPair, listContacts, removeContact, type RemoveContactDeps } from './service';

describe('remove a contact (T-1233)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function deps(): RemoveContactDeps {
    return {
      db: context.db,
      adminClient: context.adminClient,
      domain: context.config.xmpp.domain,
    };
  }

  it('removes the pair from both lists and both roster items, then answers 404', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await addContactPair(context.db, { userId: a, contactUserId: b, source: 'manual' });

    await removeContact(deps(), a, b);

    const domain = context.config.xmpp.domain;
    expect((await listContacts(context.db, a, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect((await listContacts(context.db, b, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect(context.adminClient.removedRosterItems).toEqual([
      { localpart: localpartFor(a), contactJid: expectedJid(b) },
      { localpart: localpartFor(b), contactJid: expectedJid(a) },
    ]);

    await expect(removeContact(deps(), a, b)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('cancels the accepted request, so re-accepting it cannot bring the pair back', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await addContactPair(context.db, { userId: a, contactUserId: b, source: 'manual' });
    const requestId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO contact_requests (id, from_user_id, to_user_id, status, decided_at)
          VALUES (${requestId}, ${a}, ${b}, 'accepted', ${new Date().toISOString()})`;
      }),
    );

    await removeContact(deps(), a, b);

    const [request] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string }>`SELECT status FROM contact_requests
          WHERE id = ${requestId}`;
      }),
    );
    expect(request?.status).toBe('cancelled');
    await expect(acceptContactRequest({ db: context.db }, requestId, b)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });

    const domain = context.config.xmpp.domain;
    expect((await listContacts(context.db, a, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect((await listContacts(context.db, b, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
  });

  it('a re-accept that read the request first cannot undo the removal', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await addContactPair(context.db, { userId: a, contactUserId: b, source: 'manual' });
    const requestId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO contact_requests (id, from_user_id, to_user_id, status, decided_at)
          VALUES (${requestId}, ${a}, ${b}, 'accepted', ${new Date().toISOString()})`;
      }),
    );

    // The race: the accept has read and settled the row as accepted, then the
    // removal commits delete + cancel before the accept's repair transaction
    // starts. Without the pair lock and the in-transaction status re-read the
    // repair re-inserts the pair after the removal.
    const original = sqlModule.runSql;
    let calls = 0;
    const spy = vi.spyOn(sqlModule, 'runSql').mockImplementation(async (db, effect) => {
      calls += 1;
      if (calls === 3) {
        await removeContact(deps(), a, b);
      }
      return original(db, effect);
    });
    try {
      await expect(
        acceptContactRequest(
          { db: context.db, adminClient: context.adminClient, domain: context.config.xmpp.domain },
          requestId,
          b,
        ),
      ).resolves.toMatchObject({ status: 'accepted' });
    } finally {
      spy.mockRestore();
    }

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM contacts
          WHERE (user_id = ${a} AND contact_user_id = ${b})
             OR (user_id = ${b} AND contact_user_id = ${a})`;
      }),
    );
    expect(rows).toEqual([]);
    expect(context.adminClient.rosterItems).toEqual([]);
  });
});
