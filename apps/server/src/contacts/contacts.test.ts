import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, expectedJid, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
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
});
