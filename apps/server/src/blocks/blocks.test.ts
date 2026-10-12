import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, expectedJid, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
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
