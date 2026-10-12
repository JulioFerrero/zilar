// The read mark and the unread counts (T-1198): access, forward-only
// writes, and the unread query skipping own and marked messages.

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
import { localpartFor } from '../xmpp/provisioning';

// PGlite shapes the fake the way the real `archive` table is shaped, copied
// from push/api-preview.test.ts:19-50.
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
        // Like postgres.js (T-1205): `Bind` sends values it has no serializer
        // for as text (`'' + x`). A JS `bigint[]` therefore reaches Postgres
        // as the malformed literal `10,20`, and a scalar `bigint` as `10`.
        // Reject either here so the tests fail on a parameter type the real
        // driver cannot serialize.
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

describe('PUT /api/chats/:jid/read and the unread list', () => {
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

  async function putRead(cookie: string | undefined, jid: string, messageId: string) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/read`,
      {
        method: 'PUT',
        headers: {
          ...(cookie === undefined ? {} : { cookie }),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messageId }),
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

  function dmRow(
    owner: string,
    peer: string,
    originId: string,
    timestamp: string,
    text: string | null,
  ): SeedRow {
    return {
      owner,
      peer: `${peer}/phone`,
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId,
      timestamp,
      txt: text,
      xml: `<message type="chat" from="${peer}/phone"><body>${text ?? ''}</body></message>`,
    };
  }

  // The caller's own outgoing DM: archived under their own username with
  // the recipient as bare peer, sent from their own JID.
  function ownDmRow(
    owner: string,
    ownJid: string,
    peer: string,
    originId: string,
    timestamp: string,
    text: string,
  ): SeedRow {
    return {
      owner,
      peer: `${peer}/phone`,
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId,
      timestamp,
      txt: text,
      xml: `<message type="chat" from="${ownJid}/laptop" to="${peer}"><body>${text}</body></message>`,
    };
  }

  it('answers 404 for a chat the user cannot see and writes nothing', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const strangerJid = dmJid(stranger.id);

    const { status, text } = await putRead(
      alice.cookie,
      strangerJid,
      AT('2026-06-01T00:00:00.000Z'),
    );

    expect(status).toBe(404);
    expect(text).toContain('not_found');
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM chat_reads
          WHERE user_id = ${alice.id}`;
      }),
    );
    expect(rows).toEqual([]);
  });

  it('answers 400 for a payload that fails the contract schema', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);

    for (const body of [{}, { messageId: 123 }]) {
      const response = await app.request(
        `${TEST_BASE_URL}/api/chats/${encodeURIComponent(peer)}/read`,
        {
          method: 'PUT',
          headers: { cookie: alice.cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: { code: string; message: string } };
      expect(payload.error.code).toBe('invalid_request');
    }
    // Nothing was written for either bad payload.
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM chat_reads
          WHERE user_id = ${alice.id}`;
      }),
    );
    expect(rows).toEqual([]);
  });

  it('answers 400 for a mark outside the int8 range and writes nothing', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);

    // Beyond the Postgres bigint max: the SQL cast would throw, so the mark
    // is refused before the upsert.
    for (const messageId of ['99999999999999999999999', '-1']) {
      const { status, text } = await putRead(alice.cookie, peer, messageId);
      expect(status).toBe(400);
      expect(text).toContain('invalid_request');
    }
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM chat_reads
          WHERE user_id = ${alice.id}`;
      }),
    );
    expect(rows).toEqual([]);
  });

  it('never moves the mark backwards', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);
    const owner = localpartFor(alice.id);
    await seedArchive(archiveClient, [
      dmRow(owner, peer, 'middle', AT('2026-06-02T00:00:00.000Z'), 'middle message'),
      dmRow(owner, peer, 'new', AT('2026-06-04T00:00:00.000Z'), 'new message'),
    ]);

    const newer = await putRead(alice.cookie, peer, AT('2026-06-03T00:00:00.000Z'));
    expect(newer.status).toBe(204);
    // An old device reporting an older mark must not reopen the count.
    const older = await putRead(alice.cookie, peer, AT('2026-06-01T00:00:00.000Z'));
    expect(older.status).toBe(204);

    const { status, json } = await chatList(alice.cookie);
    expect(status).toBe(200);
    const chats = (json as { chats: Array<{ chatJid: string; unread?: number }> }).chats;
    const entry = chats.find((chat) => chat.chatJid === peer);
    // Only the row after the newer mark counts; the middle row stays read.
    expect(entry?.unread).toBe(1);
  });

  it('counts only incoming rows after the mark, with a preview', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const ownJid = dmJid(alice.id);
    const peer = dmJid(bob.id);
    const owner = localpartFor(alice.id);
    await seedArchive(archiveClient, [
      dmRow(owner, peer, 'old', AT('2026-06-01T00:00:00.000Z'), 'old message'),
      ownDmRow(owner, ownJid, peer, 'mine', AT('2026-06-02T00:00:00.000Z'), 'my own message'),
      dmRow(owner, peer, 'new', AT('2026-06-03T00:00:00.000Z'), 'new message'),
    ]);
    const marked = await putRead(alice.cookie, peer, AT('2026-06-01T12:00:00.000Z'));
    expect(marked.status).toBe(204);

    const { status, json } = await chatList(alice.cookie);
    expect(status).toBe(200);
    const chats = (
      json as {
        chats: Array<{
          chatJid: string;
          unread?: number;
          lastMessage?: { id: string; text: string; archiveId?: string };
        }>;
      }
    ).chats;
    const entry = chats.find((chat) => chat.chatJid === peer);
    // One incoming row after the mark; the old row and the own row do not count.
    expect(entry?.unread).toBe(1);
    expect(entry?.lastMessage).toMatchObject({ id: 'new', text: 'new message' });
    // The preview carries its archive id (the row's timestamp): the read mark.
    expect(entry?.lastMessage?.archiveId).toBe(AT('2026-06-03T00:00:00.000Z'));
  });

  it('counts a resent message once per chat', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    const bobPeer = dmJid(bob.id);
    const carolPeer = dmJid(carol.id);
    const owner = localpartFor(alice.id);
    await seedArchive(archiveClient, [
      // Bob's message was resent under the same origin id after a lost
      // stream-management ack: the archive holds two rows, one unread.
      dmRow(owner, bobPeer, 'dup', AT('2026-10-01T12:00:00.000Z'), 'lost ack'),
      dmRow(owner, bobPeer, 'dup', AT('2026-10-01T12:04:00.000Z'), 'lost ack'),
      // Carol sent two distinct messages: two unread.
      dmRow(owner, carolPeer, 'one', AT('2026-10-01T12:00:00.000Z'), 'first'),
      dmRow(owner, carolPeer, 'two', AT('2026-10-01T12:04:00.000Z'), 'second'),
    ]);
    const bobMark = await putRead(alice.cookie, bobPeer, AT('2026-09-30T00:00:00.000Z'));
    const carolMark = await putRead(alice.cookie, carolPeer, AT('2026-09-30T00:00:00.000Z'));
    expect(bobMark.status).toBe(204);
    expect(carolMark.status).toBe(204);

    const { status, json } = await chatList(alice.cookie);
    expect(status).toBe(200);
    const chats = (
      json as {
        chats: Array<{ chatJid: string; unread?: number; lastMessage?: { id: string } }>;
      }
    ).chats;
    const bobEntry = chats.find((chat) => chat.chatJid === bobPeer);
    const carolEntry = chats.find((chat) => chat.chatJid === carolPeer);
    // The repeated origin id bumps once; the preview still shows the newest row.
    expect(bobEntry?.unread).toBe(1);
    expect(bobEntry?.lastMessage?.id).toBe('dup');
    // Distinct origin ids each bump.
    expect(carolEntry?.unread).toBe(2);
  });

  it('answers 401 without a session', async () => {
    const { status } = await putRead(undefined, 'someone@zilar.localhost', '123');

    expect(status).toBe(401);
  });

  it('answers 200 with no unread fields when the archive read fails', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);
    const failingApp = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive: {
        query: async () => {
          throw new Error('archive is down');
        },
        close: async () => {},
      },
    });

    const response = await failingApp.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      chats: Array<{ chatJid: string; unread?: number; lastMessage?: unknown }>;
    };
    expect(json.chats.map((chat) => chat.chatJid)).toContain(peer);
    for (const chat of json.chats) {
      expect(chat.unread).toBeUndefined();
      expect(chat.lastMessage).toBeUndefined();
    }
  });
});
