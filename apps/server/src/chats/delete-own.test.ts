// Clear history and delete for me (T-1236): the caller deletes their own copy
// of a DM — their archive rows with a peer — and the peer's copy is untouched.
// A group or room answers 400; an unknown chat the same 404 as the read mark.

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
  TEST_XMPP_MUC_DOMAIN,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';

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
      const result = await client.query(text, values as never[]);
      return result.rows as ArchiveRow[];
    }) as ArchivePool['query'],
    close: async () => {},
  };
}

const AT = (iso: string): string => String(Date.parse(iso) * 1000);

interface SeedRow {
  owner: string;
  peer: string;
  barePeer: string;
  timestamp: string;
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'chat', '', $7)`,
      [
        row.owner,
        row.timestamp,
        row.peer,
        row.barePeer,
        '<message type="chat"/>',
        'hello',
        'origin',
      ],
    );
  }
}

describe('DELETE /api/chats/:jid/history and /messages/:archiveId', () => {
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

  async function clearHistory(cookie: string, jid: string) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/history`,
      { method: 'DELETE', headers: { cookie } },
    );
    return { status: response.status, text: await response.text() };
  }

  async function deleteForMe(cookie: string, jid: string, archiveId: string) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/messages/${encodeURIComponent(archiveId)}`,
      { method: 'DELETE', headers: { cookie } },
    );
    return { status: response.status, text: await response.text() };
  }

  async function putRead(cookie: string, jid: string, messageId: string) {
    return app.request(`${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/read`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
  }

  async function archiveRows(
    owner: string,
  ): Promise<Array<{ barePeer: string; timestamp: string }>> {
    const result = await archiveClient.query<{ bare_peer: string; timestamp: unknown }>(
      'SELECT bare_peer, timestamp FROM archive WHERE username = $1 ORDER BY timestamp',
      [owner],
    );
    return result.rows.map((row) => ({
      barePeer: row.bare_peer,
      timestamp: String(row.timestamp),
    }));
  }

  it("clears only the caller's copy of a DM", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const aliceJid = dmJid(alice.id);
    const bobJid = dmJid(bob.id);
    const aliceOwner = localpartFor(alice.id);
    const bobOwner = localpartFor(bob.id);
    const first = AT('2026-06-01T00:00:00.000Z');
    const second = AT('2026-06-02T00:00:00.000Z');
    await seedArchive(archiveClient, [
      { owner: aliceOwner, peer: `${bobJid}/phone`, barePeer: bobJid, timestamp: first },
      { owner: aliceOwner, peer: `${bobJid}/phone`, barePeer: bobJid, timestamp: second },
      // Bob's own copy of the same conversation: a different `username`.
      { owner: bobOwner, peer: `${aliceJid}/phone`, barePeer: aliceJid, timestamp: first },
    ]);
    // A read mark of the caller's, dropped along with the history. A delivery
    // row for the caller (user_id = caller, keyed by the author's JID) too,
    // while the peer's own row (keyed by the caller's JID) stays.
    const marked = await putRead(alice.cookie, bobJid, second);
    expect(marked.status).toBe(204);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_deliveries (user_id, chat_jid, delivered_id, updated_at)
          VALUES (${alice.id}, ${bobJid}, ${second}, now()),
            (${bob.id}, ${aliceJid}, ${second}, now())`;
      }),
    );

    const cleared = await clearHistory(alice.cookie, bobJid);
    expect(cleared.status).toBe(204);

    expect(await archiveRows(aliceOwner)).toEqual([]);
    expect(await archiveRows(bobOwner)).toEqual([{ barePeer: aliceJid, timestamp: first }]);
    const marks = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM chat_reads
          WHERE user_id = ${alice.id}`;
      }),
    );
    expect(marks).toEqual([]);
    const deliveries = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string; chatJid: string }>`SELECT user_id AS "userId",
          chat_jid AS "chatJid" FROM chat_deliveries ORDER BY user_id`;
      }),
    );
    // Only the caller's delivery row is dropped; the peer's is untouched.
    expect(deliveries).toEqual([{ userId: bob.id, chatJid: aliceJid }]);
    const audit = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ action: string; detail: unknown }>`SELECT action, detail FROM audit_log
          WHERE actor_user_id = ${alice.id}`;
      }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('chat.history_cleared');
    expect(audit[0]?.detail).toEqual({ chatJid: bobJid, deleted: 2 });
  });

  it("deletes one message for the caller and answers 404 for another user's or chat's id", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    const aliceJid = dmJid(alice.id);
    const bobJid = dmJid(bob.id);
    const carolJid = dmJid(carol.id);
    const aliceOwner = localpartFor(alice.id);
    const bobOwner = localpartFor(bob.id);
    const bobFirst = AT('2026-06-01T00:00:00.000Z');
    const bobSecond = AT('2026-06-02T00:00:00.000Z');
    const carolRow = AT('2026-06-03T00:00:00.000Z');
    await seedArchive(archiveClient, [
      { owner: aliceOwner, peer: `${bobJid}/phone`, barePeer: bobJid, timestamp: bobFirst },
      { owner: aliceOwner, peer: `${bobJid}/phone`, barePeer: bobJid, timestamp: bobSecond },
      { owner: aliceOwner, peer: `${carolJid}/phone`, barePeer: carolJid, timestamp: carolRow },
      { owner: bobOwner, peer: `${aliceJid}/phone`, barePeer: aliceJid, timestamp: bobFirst },
    ]);

    const deleted = await deleteForMe(alice.cookie, bobJid, bobFirst);
    expect(deleted.status).toBe(204);
    expect(await archiveRows(aliceOwner)).toEqual([
      { barePeer: bobJid, timestamp: bobSecond },
      { barePeer: carolJid, timestamp: carolRow },
    ]);

    // Bob's own row id (another user's copy) and a row under another chat both
    // match nothing for Alice: 404, and nothing is deleted.
    const otherUser = await deleteForMe(alice.cookie, bobJid, bobFirst);
    expect(otherUser.status).toBe(404);
    const otherChat = await deleteForMe(alice.cookie, bobJid, carolRow);
    expect(otherChat.status).toBe(404);
    expect(await archiveRows(aliceOwner)).toEqual([
      { barePeer: bobJid, timestamp: bobSecond },
      { barePeer: carolJid, timestamp: carolRow },
    ]);
    expect(await archiveRows(bobOwner)).toEqual([{ barePeer: aliceJid, timestamp: bobFirst }]);
  });

  it('answers 400 for a group', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Team', memberIds: [] }),
    });
    expect(created.status).toBe(201);
    const groups = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart AS "roomLocalpart"
          FROM groups LIMIT 1`;
      }),
    );
    const groupJid = `${groups[0]!.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;

    const cleared = await clearHistory(alice.cookie, groupJid);
    expect(cleared.status).toBe(400);
    expect(cleared.text).toContain('invalid_request');
    const single = await deleteForMe(alice.cookie, groupJid, AT('2026-06-01T00:00:00.000Z'));
    expect(single.status).toBe(400);
    expect(single.text).toContain('invalid_request');
  });
});
