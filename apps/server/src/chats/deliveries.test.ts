// Delivery marks (T-1229): `PUT /api/chats/:jid/delivered` stores the
// caller's confirmation per chat (forward only), and `/api/chats` reports
// `deliveredUntil` to the sender.

import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { ArchivePool } from '../search/service';
import { notifyDelivered } from './delivered-notice';
import { putDeliveredMark } from './deliveries';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';

// PGlite shapes the fake the way the real `archive` table is shaped, copied
// from chats/reads.test.ts:23-64 (including the postgres.js-like rejection
// of `bigint` parameters, T-1205).
const ARCHIVE_DDL = `CREATE TABLE archive (
  username text NOT NULL,
  timestamp bigint NOT NULL,
  peer text NOT NULL,
  bare_peer text NOT NULL,
  xml text NOT NULL,
  txt text,
  id bigserial,
  kind text,
  nick text,
  origin_id text NOT NULL
);`;

function pgliteArchivePool(client: PGlite): ArchivePool {
  return {
    query: (async (text: string, values: unknown[]) => {
      const bound = values.map((value) => {
        if (typeof value === 'bigint') {
          throw new Error('archive fake rejects a bigint parameter (like postgres.js)');
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === 'bigint') {
              throw new Error('archive fake rejects a bigint array element (like postgres.js)');
            }
          }
          if (value.length === 0) return '{}';
          return `{${value.map((entry) => `"${String(entry).replaceAll('"', '""')}"`).join(',')}}`;
        }
        return value;
      });
      const result = await client.query(text, bound as never[]);
      return result.rows;
    }) as ArchivePool['query'],
    close: async () => {},
  };
}

const AT = (iso: string): string => String(Date.parse(iso) * 1000);

interface SeedRow {
  owner: string;
  peer: string;
  barePeer: string;
  kind: 'chat' | 'groupchat';
  nick: string;
  originId: string;
  timestamp: string;
  txt: string | null;
  xml: string;
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.owner,
        row.timestamp,
        row.peer,
        row.barePeer,
        row.xml,
        row.txt,
        row.kind,
        row.nick,
        row.originId,
      ],
    );
  }
}

describe('PUT /api/chats/:jid/delivered and deliveredUntil', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let archiveClient: PGlite;
  let archive: ArchivePool;

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    archive = pgliteArchivePool(archiveClient);
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive,
    });
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  async function putDelivered(cookie: string | undefined, jid: string, originIds: unknown) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/delivered`,
      {
        method: 'PUT',
        headers: {
          ...(cookie === undefined ? {} : { cookie }),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ originIds }),
      },
    );
    const text = await response.text();
    return { status: response.status, text };
  }

  async function chatList(cookie: string): Promise<{ status: number; json: unknown }> {
    const response = await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie } });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  function entryFor(json: unknown, chatJid: string): { deliveredUntil?: string } {
    const chats = (json as { chats: Array<{ chatJid: string; deliveredUntil?: string }> }).chats;
    return chats.find((chat) => chat.chatJid === chatJid) ?? {};
  }

  // A message the author sent to the recipient: archived under the author's
  // own username with the recipient as bare peer, stamped from the author.
  function authorDmRow(
    authorLocalpart: string,
    recipientJid: string,
    originId: string,
    timestamp: string,
  ): SeedRow {
    return {
      owner: authorLocalpart,
      peer: recipientJid,
      barePeer: recipientJid,
      kind: 'chat',
      nick: '',
      originId,
      timestamp,
      txt: 'hello',
      xml: `<message type="chat" from="${authorLocalpart}@${TEST_XMPP_DOMAIN}/laptop" to="${recipientJid}"><body>hello</body></message>`,
    };
  }

  it('a DM confirm sets the mark, and /api/chats shows deliveredUntil to the peer', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const aliceJid = dmJid(alice.id);
    const bobJid = dmJid(bob.id);
    await seedArchive(archiveClient, [
      authorDmRow(localpartFor(alice.id), bobJid, 'origin-1', AT('2026-06-01T00:00:00.000Z')),
      authorDmRow(localpartFor(alice.id), bobJid, 'origin-2', AT('2026-06-02T00:00:00.000Z')),
    ]);

    // Bob's device confirms both messages; the mark is the newest confirmed
    // archive id in Alice's (the author's) terms.
    const confirmed = await putDelivered(bob.cookie, aliceJid, ['origin-1', 'origin-2']);
    expect(confirmed.status).toBe(204);

    const { status, json } = await chatList(alice.cookie);
    expect(status).toBe(200);
    expect(entryFor(json, bobJid).deliveredUntil).toBe(AT('2026-06-02T00:00:00.000Z'));
    // Bob sees no mark on his own side: Alice confirmed nothing to him.
    const bobList = await chatList(bob.cookie);
    expect(bobList.status).toBe(200);
    expect(entryFor(bobList.json, aliceJid).deliveredUntil).toBeUndefined();
  });

  it('an older confirm does not move the mark back', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const aliceJid = dmJid(alice.id);
    const bobJid = dmJid(bob.id);
    await seedArchive(archiveClient, [
      authorDmRow(localpartFor(alice.id), bobJid, 'origin-old', AT('2026-06-01T00:00:00.000Z')),
      authorDmRow(localpartFor(alice.id), bobJid, 'origin-new', AT('2026-06-03T00:00:00.000Z')),
    ]);

    expect((await putDelivered(bob.cookie, aliceJid, ['origin-new'])).status).toBe(204);
    expect((await putDelivered(bob.cookie, aliceJid, ['origin-old'])).status).toBe(204);

    const { json } = await chatList(alice.cookie);
    expect(entryFor(json, bobJid).deliveredUntil).toBe(AT('2026-06-03T00:00:00.000Z'));
  });

  it('answers 404 for an unknown or invisible chat and 401 without a session', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const strangerJid = dmJid(stranger.id);

    const { status, text } = await putDelivered(alice.cookie, strangerJid, ['origin-1']);
    expect(status).toBe(404);
    expect(text).toContain('not_found');

    const unauthenticated = await putDelivered(undefined, strangerJid, ['origin-1']);
    expect(unauthenticated.status).toBe(401);
  });

  it('in a group, the max over other members is shown, and the caller’s own mark is not counted', async () => {
    // This test owns its users and origin ids (`grp-*`, confirmed only
    // here): the archive fake is per test, and the database is per test
    // file, so no other test's confirms can move these marks.
    const alice = await bootstrapUser(context, app, 'galice@example.com');
    const bob = await contactOf(context, app, alice.id, 'gbob@example.com');
    const carol = await contactOf(context, app, alice.id, 'gcarol@example.com');
    const ownerId = await seedUser(context);
    // The room archive the confirms read: Alice's messages live here, and
    // Bob/Carol/Alice confirm from it. The room JID is derived from the
    // seeded topic below.
    const { generalTopicId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: alice.id, role: 'member' },
        { userId: bob.id, role: 'member' },
        { userId: carol.id, role: 'member' },
      ],
      [],
    );
    const [topic] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
          WHERE id = ${generalTopicId} LIMIT 1`;
      }),
    );
    if (topic === undefined) {
      throw new Error('seeded general topic not found');
    }
    const roomJid = `${topic.roomLocalpart}@${context.config.xmpp.mucDomain}`.toLowerCase();
    // A group message from Alice: archived under the room's own username
    // with her account localpart as nick (the same shape
    // push/group-notifier.test.ts:114-126 uses). `localpartFor` is exactly
    // what provisioning stores (`xmpp/provisioning.ts:52-59`), so the nick
    // matches the caller's own rows in every run.
    const groupRow = (
      owner: string,
      senderId: string,
      originId: string,
      timestamp: string,
    ): SeedRow => ({
      owner,
      peer: owner,
      barePeer: '',
      kind: 'groupchat',
      nick: localpartFor(senderId),
      originId,
      timestamp,
      txt: 'group text',
      xml: `<message type="groupchat" from="${owner}/${localpartFor(senderId)}"><body>group text</body></message>`,
    });
    // Alice sent two messages; Bob confirms both, Carol the older one.
    // Alice also "confirms" the newer one herself: her own mark must not
    // count towards what she sees. Bob's mark is the newest timestamp, so
    // the max over the other members is his.
    await seedArchive(archiveClient, [
      groupRow(roomJid, alice.id, 'grp-one', AT('2026-06-01T00:00:00.000Z')),
      groupRow(roomJid, alice.id, 'grp-two', AT('2026-06-02T00:00:00.000Z')),
    ]);
    expect((await putDelivered(bob.cookie, roomJid, ['grp-one', 'grp-two'])).status).toBe(204);
    expect((await putDelivered(carol.cookie, roomJid, ['grp-one'])).status).toBe(204);
    expect((await putDelivered(alice.cookie, roomJid, ['grp-two'])).status).toBe(204);

    const { status, json } = await chatList(alice.cookie);
    expect(status).toBe(200);
    // The mark lands on the General topic view (the room that was
    // confirmed); the group entry itself carries no mark.
    const groups = (
      json as {
        chats: Array<{
          kind: string;
          topics?: Array<{ chatJid: string; deliveredUntil?: string }>;
        }>;
      }
    ).chats;
    const groupEntry = groups.find((chat) => chat.kind === 'group');
    const general = groupEntry?.topics?.find((topic) => topic.chatJid === roomJid);
    // The max over the other members: Bob confirmed both, so his newer mark
    // wins over Carol's older one (and Alice's own mark does not count).
    expect(general?.deliveredUntil).toBe(AT('2026-06-02T00:00:00.000Z'));
    // Bob sees Carol's older mark only: his own confirm does not count.
    const bobList = await chatList(bob.cookie);
    expect(bobList.status).toBe(200);
    const bobGroups = (
      bobList.json as {
        chats: Array<{
          kind: string;
          topics?: Array<{ chatJid: string; deliveredUntil?: string }>;
        }>;
      }
    ).chats;
    const bobGeneral = bobGroups
      .find((chat) => chat.kind === 'group')
      ?.topics?.find((topic) => topic.chatJid === roomJid);
    expect(bobGeneral?.deliveredUntil).toBe(AT('2026-06-01T00:00:00.000Z'));
  });

  it('a moved DM mark notifies each online resource of the author, and an unmoved mark notifies nothing', async () => {
    const alice = await bootstrapUser(context, app, 'livealice@example.com');
    const bob = await contactOf(context, app, alice.id, 'livebob@example.com');
    const aliceJid = dmJid(alice.id);
    const bobJid = dmJid(bob.id);
    const timestamp = AT('2026-06-04T00:00:00.000Z');
    await seedArchive(archiveClient, [
      authorDmRow(localpartFor(alice.id), bobJid, 'origin-live', timestamp),
    ]);
    context.adminClient.setOnlineResources(localpartFor(alice.id), ['web', 'phone']);

    const moved = await putDeliveredMark(context.db, context.config, archive, {
      bare: aliceJid,
      userId: bob.id,
      originIds: ['origin-live'],
    });
    if (moved === undefined) {
      throw new Error('expected a moved DM notice');
    }
    expect(moved).toEqual({ authorBare: aliceJid, chatJid: bobJid, until: timestamp });

    await Effect.runPromise(
      notifyDelivered({
        adminClient: context.adminClient,
        logger: context.logger,
        notice: moved,
      }),
    );

    // One stanza per online resource, all from the author's own bare JID to a
    // full JID (never the bare JID, so nothing is queued offline).
    expect(context.adminClient.sentStanzas.map((sent) => sent.to)).toEqual([
      `${aliceJid}/web`,
      `${aliceJid}/phone`,
    ]);
    expect(context.adminClient.sentStanzas[0]?.from).toBe(aliceJid);
    expect(context.adminClient.sentStanzas[0]?.stanza).toBe(
      `<message type='headline' from='${aliceJid}' to='${aliceJid}/web'>` +
        `<delivered xmlns='urn:zilar:delivered:0' chat='${bobJid}' until='${timestamp}'/>` +
        `<no-store xmlns='urn:xmpp:hints'/>` +
        `</message>`,
    );

    // The same mark confirmed again does not move: no notice, no new stanza.
    const unmoved = await putDeliveredMark(context.db, context.config, archive, {
      bare: aliceJid,
      userId: bob.id,
      originIds: ['origin-live'],
    });
    expect(unmoved).toBeUndefined();
    expect(context.adminClient.sentStanzas).toHaveLength(2);
  });
});
