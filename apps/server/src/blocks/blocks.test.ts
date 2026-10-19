import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, expectedJid, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { acceptContactRequest } from '../contact-requests/api';
import { addContactPair, listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { allowedArchives } from '../search/service';
import { localpartFor } from '../xmpp/provisioning';
import { removeBlockRosterItems } from './roster';
import { blockUser, type BlocksDeps } from './service';

describe('block really blocks (T-1158)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function blockDeps(): BlocksDeps {
    return {
      db: context.db,
      adminClient: context.adminClient,
      domain: context.config.xmpp.domain,
    };
  }

  it('removes the contact pair from both lists and both roster items', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await addContactPair(context.db, { userId: a, contactUserId: b, source: 'manual' });

    await blockUser(blockDeps(), a, b);

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
  });

  it('still filters a legacy contact row written after the block', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    await addContactPair(context.db, { userId: a, contactUserId: b, source: 'manual' });

    await blockUser(blockDeps(), a, b);

    // A stale row from an older version (or re-added between blocks): it must
    // still not show on either side, in lists or in the archive scope.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO contacts (user_id, contact_user_id, source)
          VALUES (${a}, ${b}, 'manual'), (${b}, ${a}, 'manual')
          ON CONFLICT DO NOTHING`;
      }),
    );

    const domain = context.config.xmpp.domain;
    expect((await listContacts(context.db, a, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect((await listContacts(context.db, b, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect((await allowedArchives(context.db, context.config, a)).dmPeers).toEqual([]);
  });

  it('cancels the accepted request with the pair, so a re-accept cannot undo the block', async () => {
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

    await blockUser(blockDeps(), a, b);

    const [request] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string }>`SELECT status FROM contact_requests
          WHERE id = ${requestId}`;
      }),
    );
    expect(request?.status).toBe('cancelled');

    // A row an older server left accepted still must not repair the pair back.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE contact_requests SET status = 'accepted' WHERE id = ${requestId}`;
      }),
    );
    // Pass the admin client and domain, so a repair that ignored the block
    // would push both `both` roster items and fail the assertions below.
    const domain = context.config.xmpp.domain;
    const acceptDeps = { db: context.db, adminClient: context.adminClient, domain };
    await expect(acceptContactRequest(acceptDeps, requestId, b)).resolves.toMatchObject({
      status: 'accepted',
    });

    expect((await listContacts(context.db, a, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    expect((await listContacts(context.db, b, domain)).map((contact) => contact.userId)).toEqual(
      [],
    );
    // `listContacts` hides blocked pairs by construction, so read the raw rows
    // too: a resurrected pair must not exist even where the filter cannot see.
    const rawRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM contacts
          WHERE (user_id = ${a} AND contact_user_id = ${b})
             OR (user_id = ${b} AND contact_user_id = ${a})`;
      }),
    );
    expect(rawRows).toEqual([]);
    // The repair also must not re-push the `both` roster subscriptions: the
    // pair stays gone in ejabberd as well as in `contacts`.
    expect(context.adminClient.rosterItems).toEqual([]);
  });

  it('repairs a half-finished accept under the pair lock and syncs both rosters', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    const requestId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO contact_requests (id, from_user_id, to_user_id, status, decided_at)
          VALUES (${requestId}, ${a}, ${b}, 'accepted', ${new Date().toISOString()})`;
      }),
    );
    const domain = context.config.xmpp.domain;
    const acceptDeps = { db: context.db, adminClient: context.adminClient, domain };

    await expect(acceptContactRequest(acceptDeps, requestId, b)).resolves.toMatchObject({
      status: 'accepted',
    });

    expect((await listContacts(context.db, a, domain)).map((contact) => contact.userId)).toEqual([
      b,
    ]);
    expect((await listContacts(context.db, b, domain)).map((contact) => contact.userId)).toEqual([
      a,
    ]);
    expect(
      context.adminClient.rosterItems.map(({ localpart, contactJid, subs }) => ({
        localpart,
        contactJid,
        subs,
      })),
    ).toEqual([
      { localpart: localpartFor(a), contactJid: expectedJid(b), subs: 'both' },
      { localpart: localpartFor(b), contactJid: expectedJid(a), subs: 'both' },
    ]);

    // A second accept is still idempotent: the rows are synced, so nothing is
    // pushed twice.
    await acceptContactRequest(acceptDeps, requestId, b);
    expect(context.adminClient.rosterItems).toHaveLength(2);
  });

  it('still removes both roster items when the JID lookups fail', async () => {
    const a = await seedUser(context, { name: 'User A' });
    const b = await seedUser(context, { name: 'User B' });
    const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
    // A database whose runtime was never registered: every `runSql` on it
    // throws, like a DB hiccup right after the block commit.
    const brokenDb = {} as ServerDatabase;
    const domain = context.config.xmpp.domain;

    await removeBlockRosterItems({
      db: brokenDb,
      adminClient: context.adminClient,
      domain,
      logger: { warn: (fields, message) => warnings.push({ fields, message }) },
      userId: a,
      targetId: b,
    });

    expect(context.adminClient.removedRosterItems).toEqual([
      { localpart: localpartFor(a), contactJid: expectedJid(b) },
      { localpart: localpartFor(b), contactJid: expectedJid(a) },
    ]);
    expect(warnings).toHaveLength(1);
  });
});
