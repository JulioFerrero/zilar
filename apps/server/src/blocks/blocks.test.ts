import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, expectedJid, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { addContactPair, listContacts } from '../contacts/service';
import { localpartFor } from '../xmpp/provisioning';
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
});
