import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { ArchivePool, ArchiveRow } from '../search/service';
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
import { flushMicrotasks, waitFor } from '../test-support/wait';
import { localpartFor } from '../xmpp/provisioning';

// PGlite shapes the fake the way the real `archive` table is shaped, copied
// from files/routes.test.ts.
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
        if (typeof value === 'bigint') return value.toString();
        if (Array.isArray(value)) {
          if (value.length === 0) return '{}';
          return `{${value.map((entry) => `"${String(entry).replaceAll('"', '""')}"`).join(',')}}`;
        }
        return value;
      });
      const result = await client.query(text, bound as never[]);
      return result.rows as ArchiveRow[];
    }) as ArchivePool['query'],
    close: async () => {},
  };
}

interface SeedRow {
  owner: string;
  peer: string;
  barePeer: string;
  kind: 'chat' | 'groupchat';
  nick: string;
  originId: string;
  txt: string;
  xml: string;
  /** Archive microseconds; defaults to the fixed 2026-06-01 row time. */
  timestamp?: number;
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.owner,
        row.timestamp ?? Date.parse('2026-06-01T00:00:00.000Z') * 1000,
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

describe('GET /api/push/preview', () => {
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

  async function preview(cookie: string | undefined, messageId: string) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/push/preview?messageId=${encodeURIComponent(messageId)}`,
      { headers: cookie === undefined ? {} : { cookie } },
    );
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  function errorCode(json: unknown): string | undefined {
    if (typeof json !== 'object' || json === null || !('error' in json)) {
      return undefined;
    }
    const error = (json as { error: unknown }).error;
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return undefined;
    }
    return (error as { code: unknown }).code as string;
  }

  async function setName(userId: string, name: string): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE "user" SET name = ${name} WHERE id = ${userId}`;
      }),
    );
  }

  async function setShowPreviews(userId: string, showPreviews: boolean): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO push_settings (user_id, show_previews, updated_at)
          VALUES (${userId}, ${showPreviews}, now())`;
      }),
    );
  }

  async function deliveredMarks(userId: string) {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          chatJid: string;
          deliveredId: string;
        }>`SELECT chat_jid AS "chatJid", delivered_id AS "deliveredId"
          FROM chat_deliveries WHERE user_id = ${userId}`;
      }),
    );
  }

  // Alice and Bob are contacts, so Bob's DM archive is in Alice's allowed set.
  async function setupDm() {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await setName(bob.id, 'Bob');
    const peer = dmJid(bob.id);
    return { alice, bob, peer };
  }

  function dmRow(owner: string, peer: string, originId: string, text: string): SeedRow {
    return {
      owner,
      peer: `${peer}/phone`,
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId,
      txt: text,
      xml: `<message type="chat" from="${peer}/phone"><body>${text}</body></message>`,
    };
  }

  it('answers 200 with the sender as title and the text as body', async () => {
    const { alice, peer } = await setupDm();
    await seedArchive(archiveClient, [
      dmRow(localpartFor(alice.id), peer, 'origin-1', 'Hello there'),
    ]);

    const { status, json } = await preview(alice.cookie, 'origin-1');

    expect(status).toBe(200);
    expect(json).toMatchObject({ title: 'Bob', body: 'Hello there', chatId: peer });
    // T-1893: the notification needs the archive id for Mark as read.
    expect((json as { archiveId?: string }).archiveId).toBe(
      String(Date.parse('2026-06-01T00:00:00.000Z') * 1000),
    );
  });

  it('hides a retracted message and previews a correction’s latest text', async () => {
    const { alice, peer } = await setupDm();
    const owner = localpartFor(alice.id);
    const base = Date.parse('2026-06-01T00:00:00.000Z') * 1000;
    const retract = `<message type="chat" from="${peer}/phone"><retract xmlns="urn:xmpp:message-retract:1" id="origin-1"/></message>`;
    const correct = `<message type="chat" from="${peer}/phone"><body>New text</body><replace xmlns="urn:xmpp:message-correct:0" id="origin-2"/></message>`;
    await seedArchive(archiveClient, [
      dmRow(owner, peer, 'origin-1', 'Hello there'),
      { ...dmRow(owner, peer, 'retract-1', '…'), xml: retract },
      { ...dmRow(owner, peer, 'origin-2', 'Old text'), timestamp: base },
      { ...dmRow(owner, peer, 'edit-2', 'New text'), timestamp: base + 1000, xml: correct },
    ]);

    expect((await preview(alice.cookie, 'origin-1')).status).toBe(404);
    const corrected = await preview(alice.cookie, 'origin-2');
    expect(corrected.status).toBe(200);
    expect(corrected.json).toMatchObject({ body: 'New text' });
  });

  it('returns the chat’s unread count as the notification badge (T-1897)', async () => {
    const { alice, peer } = await setupDm();
    // Recent rows so both sit above the 30-day floor of an unmarked chat.
    const now = Date.now() * 1000;
    await seedArchive(archiveClient, [
      { ...dmRow(localpartFor(alice.id), peer, 'origin-a', 'First'), timestamp: now - 2000 },
      { ...dmRow(localpartFor(alice.id), peer, 'origin-b', 'Second'), timestamp: now - 1000 },
    ]);

    const { status, json } = await preview(alice.cookie, 'origin-b');

    expect(status).toBe(200);
    // Alice has no read mark, so both rows are unread.
    expect((json as { unread?: number }).unread).toBe(2);
  });

  it('answers the generic body when previews are off', async () => {
    const { alice, peer } = await setupDm();
    await setShowPreviews(alice.id, false);
    await seedArchive(archiveClient, [
      dmRow(localpartFor(alice.id), peer, 'origin-2', 'Secret text'),
    ]);

    const { status, json } = await preview(alice.cookie, 'origin-2');

    expect(status).toBe(200);
    expect(json).toMatchObject({ title: 'Bob', body: 'New message', chatId: peer });
  });

  it('stores the caller’s delivered mark for a DM message it may see', async () => {
    const { alice, bob, peer } = await setupDm();
    const aliceJid = dmJid(alice.id);
    // The message as Alice's device reads it (her own archive, from Bob)…
    const asRead: SeedRow = {
      owner: localpartFor(alice.id),
      peer: `${peer}/phone`,
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'origin-dm',
      txt: 'Hello there',
      xml: `<message type="chat" from="${peer}/phone"><body>Hello there</body></message>`,
    };
    // …and Bob's (the author's) own copy under the same origin id. The mark is
    // stored in the author's terms, exactly like PUT /chats/:jid/delivered
    // (deliveries.ts `deliveryScopeForChat`): the author's localpart with the
    // caller as bare peer.
    const authorsCopy: SeedRow = {
      owner: localpartFor(bob.id),
      peer: aliceJid,
      barePeer: aliceJid,
      kind: 'chat',
      nick: '',
      originId: 'origin-dm',
      txt: 'Hello there',
      xml: `<message type="chat" from="${peer}/phone"><body>Hello there</body></message>`,
    };
    await seedArchive(archiveClient, [asRead, authorsCopy]);

    const { status } = await preview(alice.cookie, 'origin-dm');

    expect(status).toBe(200);
    // The mark is forked off the HTTP answer, so let it land.
    await waitFor(async () => (await deliveredMarks(alice.id)).length === 1, {
      label: 'the delivered mark',
    });
    const expected = String(Date.parse('2026-06-01T00:00:00.000Z') * 1000);
    expect(await deliveredMarks(alice.id)).toEqual([{ chatJid: peer, deliveredId: expected }]);
  });

  it('stores no delivered mark for an unknown id', async () => {
    const { alice } = await setupDm();

    const { status, json } = await preview(alice.cookie, 'origin-unknown');

    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
    await flushMicrotasks();
    expect(await deliveredMarks(alice.id)).toEqual([]);
  });

  it('answers 404 for a message in a room the caller is not in', async () => {
    const { alice } = await setupDm();
    const ownerId = await seedUser(context);
    const { groupId } = await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], []);
    const [group] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
          WHERE id = ${groupId} LIMIT 1`;
      }),
    );
    if (group === undefined) {
      throw new Error(`group ${groupId} was not seeded`);
    }
    const roomJid = `${group.roomLocalpart}@${context.config.xmpp.mucDomain}`.toLowerCase();
    await seedArchive(archiveClient, [
      {
        owner: roomJid,
        peer: roomJid,
        barePeer: 'someone@zilar.localhost',
        kind: 'groupchat',
        nick: 'Someone',
        originId: 'origin-secret',
        txt: 'not for you',
        xml: '<message type="groupchat"><body>not for you</body></message>',
      },
    ]);

    const { status, json } = await preview(alice.cookie, 'origin-secret');

    expect(status).toBe(404);
    expect(errorCode(json)).toBe('not_found');
  });

  it('answers 404 for an AI progress card and for an edit of one', async () => {
    const { alice, peer } = await setupDm();
    const owner = localpartFor(alice.id);
    const card = `<message type="chat" from="${peer}/desk"><body>Searching</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"${peer}","stage":"Searching"}}</agent></message>`;
    const correction = `<message type="chat" from="${peer}/desk"><body>Working</body><replace xmlns="urn:xmpp:message-correct:0" id="card-1"/></message>`;
    const retraction = `<message type="chat" from="${peer}/desk"><body>…attempted to retract…</body><retract xmlns="urn:xmpp:message-retract:1" id="card-1"/></message>`;
    await seedArchive(archiveClient, [
      {
        owner,
        peer: `${peer}/desk`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'card-1',
        txt: 'Searching',
        xml: card,
      },
      {
        owner,
        peer: `${peer}/desk`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'edit-1',
        txt: 'Working',
        xml: correction,
      },
      {
        owner,
        peer: `${peer}/desk`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'retract-1',
        txt: '…',
        xml: retraction,
      },
      dmRow(owner, peer, 'origin-answer', 'Here is the answer'),
    ]);

    // The card and its edits are not messages: no preview, like a muted or
    // hidden row (T-1400). The edit only names its target, so the route reads
    // it; the retraction is skipped by the resolver's retraction rule anyway.
    for (const id of ['card-1', 'edit-1', 'retract-1']) {
      const { status, json } = await preview(alice.cookie, id);
      expect(status).toBe(404);
      expect(errorCode(json)).toBe('not_found');
    }
    // A real message still previews.
    const answer = await preview(alice.cookie, 'origin-answer');
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ title: 'Bob', body: 'Here is the answer', chatId: peer });
  });

  it('answers 401 without a session', async () => {
    const { status } = await preview(undefined, 'origin-1');

    expect(status).toBe(401);
  });
});
