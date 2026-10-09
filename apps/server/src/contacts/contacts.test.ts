import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createInvite } from '../auth/invites';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  FakeAdminClient,
  signUpWithInvite,
  testApp,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { UNNAMED_CONTACT_NAME } from './service';

interface ContactRow {
  userId: string;
  contactUserId: string;
  source: string;
  rosterSynced: boolean;
}

interface UserNameRow {
  id: string;
  name: string;
}

interface UserInviteRow {
  userId: string;
  invitedBy: string | null;
  inviteId: string | null;
}

describe('contacts from invites', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function contactRows(source: Pick<TestContext, 'db'> = context) {
    return testSql(source)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<ContactRow>`SELECT user_id, contact_user_id, source, roster_synced FROM contacts`;
      }),
    );
  }

  async function userNames() {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<UserNameRow>`SELECT id, name FROM "user"`;
      }),
    );
  }

  async function userInviteRows() {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<UserInviteRow>`SELECT user_id, invited_by, invite_id FROM user_invites`;
      }),
    );
  }

  async function setDisplayName(cookie: string, name: string): Promise<void> {
    const response = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(200);
  }

  it('makes the inviter and the invitee contacts with two roster items', async () => {
    const inviter = await bootstrapUser(context, app, 'inviter@example.com');
    await setDisplayName(inviter.cookie, 'Alice Inviter');
    const invite = await createInvite(context.db, { createdBy: inviter.id });
    const invitee = await signUpWithInvite(context, app, 'invitee@example.com', invite.code);

    const rows = await contactRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => `${row.userId}->${row.contactUserId}`).sort()).toEqual(
      [`${inviter.id}->${invitee.id}`, `${invitee.id}->${inviter.id}`].sort(),
    );
    expect(rows.every((row) => row.source === 'invite' && row.rosterSynced)).toBe(true);

    const names = new Map((await userNames()).map((row) => [row.id, row.name]));
    expect(context.adminClient.rosterItems).toHaveLength(2);
    expect(context.adminClient.rosterItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localpart: localpartFor(inviter.id),
          contactJid: `${localpartFor(invitee.id)}@${TEST_XMPP_DOMAIN}`,
          nick: names.get(invitee.id),
          groups: ['Zilar'],
          subs: 'both',
        }),
        expect.objectContaining({
          localpart: localpartFor(invitee.id),
          contactJid: `${localpartFor(inviter.id)}@${TEST_XMPP_DOMAIN}`,
          nick: names.get(inviter.id),
          groups: ['Zilar'],
          subs: 'both',
        }),
      ]),
    );
    // The invitee has no display name yet at sign-up (Better Auth uses ""),
    // so the owner's roster item follows the stored name exactly.
    expect(names.get(inviter.id)).toBe('Alice Inviter');
    expect(names.get(invitee.id)).toBe('');

    const claims = await userInviteRows();
    expect(claims).toHaveLength(2);
    expect(claims.find((claim) => claim.userId === invitee.id)).toMatchObject({
      userId: invitee.id,
      invitedBy: inviter.id,
      inviteId: invite.id,
    });
  });

  it('creates no contacts for a bootstrap invite', async () => {
    const userRecord = await bootstrapUser(context, app, 'bootstrap@example.com');

    expect(await contactRows()).toHaveLength(0);
    expect(context.adminClient.rosterItems).toHaveLength(0);

    const claims = await userInviteRows();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ userId: userRecord.id, invitedBy: null });
  });

  it('stores contacts when the roster sync fails and retries on the token endpoint', async () => {
    const adminClient = new FakeAdminClient();
    adminClient.failRoster = true;
    const failing = await createTestContext({ adminClient });
    try {
      const failingApp = testApp(failing);
      const inviter = await bootstrapUser(failing, failingApp, 'inviter@example.com');
      const invite = await createInvite(failing.db, { createdBy: inviter.id });
      const invitee = await signUpWithInvite(
        failing,
        failingApp,
        'invitee@example.com',
        invite.code,
      );

      const rows = await contactRows(failing);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => !row.rosterSynced)).toBe(true);
      expect(adminClient.rosterItems).toHaveLength(0);

      adminClient.failRoster = false;

      // The invitee's token request syncs only the invitee's own roster item.
      const token = await failingApp.request(`${TEST_BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie: invitee.cookie },
      });
      expect(token.status).toBe(200);
      expect(adminClient.rosterItems).toHaveLength(1);
      expect(adminClient.rosterItems[0]).toMatchObject({
        localpart: localpartFor(invitee.id),
        contactJid: `${localpartFor(inviter.id)}@${TEST_XMPP_DOMAIN}`,
      });

      const afterInvitee = await contactRows(failing);
      expect(afterInvitee.filter((row) => row.userId === invitee.id)).toEqual([
        expect.objectContaining({ rosterSynced: true }),
      ]);
      expect(afterInvitee.filter((row) => row.userId === inviter.id)).toEqual([
        expect.objectContaining({ rosterSynced: false }),
      ]);

      // The inviter's next token request syncs the other direction.
      const inviterToken = await failingApp.request(`${TEST_BASE_URL}/api/xmpp/token`, {
        method: 'POST',
        headers: { cookie: inviter.cookie },
      });
      expect(inviterToken.status).toBe(200);
      expect(adminClient.rosterItems).toHaveLength(2);
      const finalRows = await contactRows(failing);
      expect(finalRows.every((row) => row.rosterSynced)).toBe(true);
    } finally {
      await failing.close();
    }
  });

  it('GET /api/contacts returns only my contacts', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const carol = await bootstrapUser(context, app, 'carol@example.com');

    const response = await app.request(`${TEST_BASE_URL}/api/contacts`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const list = (await response.json()) as Array<{
      userId: string;
      name: string;
      jid: string;
      avatarUrl?: string;
    }>;
    expect(list.map((contact) => contact.userId)).toEqual([bob.id]);
    expect(list[0]?.jid).toBe(`${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`);

    const carolResponse = await app.request(`${TEST_BASE_URL}/api/contacts`, {
      headers: { cookie: carol.cookie },
    });
    expect(await carolResponse.json()).toEqual([]);

    const bobResponse = await app.request(`${TEST_BASE_URL}/api/contacts`, {
      headers: { cookie: bob.cookie },
    });
    const bobList = (await bobResponse.json()) as Array<{ userId: string }>;
    expect(bobList.map((contact) => contact.userId)).toEqual([alice.id]);
  });

  it('names blank contacts "Unnamed user", sorts them last, and never leaks email', async () => {
    const alice = await bootstrapUser(context, app, 'alice-blank@example.com');
    const empty = await contactOf(context, app, alice.id, 'empty-blank@example.com');
    const spaces = await contactOf(context, app, alice.id, 'spaces-blank@example.com');
    const zara = await contactOf(context, app, alice.id, 'zara-blank@example.com');
    const amy = await contactOf(context, app, alice.id, 'amy-blank@example.com');
    await setDisplayName(zara.cookie, 'Zara');
    await setDisplayName(amy.cookie, 'Amy');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE "user" SET name = ${'   '} WHERE id = ${spaces.id}`;
      }),
    );

    const response = await app.request(`${TEST_BASE_URL}/api/contacts`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const list = (await response.json()) as Array<{
      userId: string;
      name: string;
      jid: string;
      avatarUrl?: string;
    }>;

    expect(list.map((contact) => contact.name)).toEqual([
      'Amy',
      'Zara',
      UNNAMED_CONTACT_NAME,
      UNNAMED_CONTACT_NAME,
    ]);
    expect(list.slice(0, 2).map((contact) => contact.userId)).toEqual([amy.id, zara.id]);
    expect(
      list
        .slice(2)
        .map((contact) => contact.userId)
        .sort(),
    ).toEqual([empty.id, spaces.id].sort());

    const text = JSON.stringify(list);
    for (const email of [
      'alice-blank@example.com',
      'empty-blank@example.com',
      'spaces-blank@example.com',
      'zara-blank@example.com',
      'amy-blank@example.com',
    ]) {
      expect(text).not.toContain(email);
    }
    expect(list.every((contact) => !('email' in contact))).toBe(true);
  });

  it('updates the nickname in every contact roster when the name changes', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    context.adminClient.rosterItems.length = 0;

    await setDisplayName(alice.cookie, 'Alice Wonderland');

    expect(context.adminClient.rosterItems).toHaveLength(2);
    expect(context.adminClient.rosterItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localpart: localpartFor(bob.id),
          contactJid: `${localpartFor(alice.id)}@${TEST_XMPP_DOMAIN}`,
          nick: 'Alice Wonderland',
          groups: ['Zilar'],
          subs: 'both',
        }),
        expect.objectContaining({
          localpart: localpartFor(carol.id),
          contactJid: `${localpartFor(alice.id)}@${TEST_XMPP_DOMAIN}`,
          nick: 'Alice Wonderland',
          groups: ['Zilar'],
          subs: 'both',
        }),
      ]),
    );

    const rows = (await contactRows()).filter((row) => row.contactUserId === alice.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.rosterSynced)).toBe(true);
  });

  it('marks the rows unsynced when the nickname refresh fails, and the contact token call resyncs', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    context.adminClient.rosterItems.length = 0;

    context.adminClient.failRoster = true;
    await setDisplayName(alice.cookie, 'Alice Wonderland');

    const unsynced = (await contactRows()).filter((row) => row.contactUserId === alice.id);
    expect(unsynced).toHaveLength(2);
    expect(unsynced.every((row) => !row.rosterSynced)).toBe(true);
    expect(context.adminClient.rosterItems).toHaveLength(0);

    context.adminClient.failRoster = false;
    const bobToken = await app.request(`${TEST_BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie: bob.cookie },
    });
    expect(bobToken.status).toBe(200);
    expect(context.adminClient.rosterItems).toEqual([
      expect.objectContaining({
        localpart: localpartFor(bob.id),
        contactJid: `${localpartFor(alice.id)}@${TEST_XMPP_DOMAIN}`,
        nick: 'Alice Wonderland',
      }),
    ]);

    const afterBob = await contactRows();
    expect(
      afterBob.find((row) => row.userId === bob.id && row.contactUserId === alice.id)?.rosterSynced,
    ).toBe(true);
    expect(
      afterBob.find((row) => row.userId === carol.id && row.contactUserId === alice.id)
        ?.rosterSynced,
    ).toBe(false);

    const carolToken = await app.request(`${TEST_BASE_URL}/api/xmpp/token`, {
      method: 'POST',
      headers: { cookie: carol.cookie },
    });
    expect(carolToken.status).toBe(200);
    expect(context.adminClient.rosterItems).toHaveLength(2);
    const afterCarol = (await contactRows()).filter((row) => row.contactUserId === alice.id);
    expect(afterCarol.every((row) => row.rosterSynced)).toBe(true);
  });

  it('requires authentication', async () => {
    const response = await app.request(`${TEST_BASE_URL}/api/contacts`);
    expect(response.status).toBe(401);
  });
});
