// T-1361: a push wake forks the caller's delivered mark for the previewed
// message (T-1257), but `/api/chats` counts unread from the read mark only. A
// delivered row for the newest message must not hide its unread count.
// `reads.test.ts` is at its 400-line bar, so this case lives here.

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

// Shaped like the real `archive` table, copied from reads.test.ts:23-64.
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
        // Like postgres.js: no serializer for a bigint, so reject it here.
        if (typeof value === 'bigint') {
          throw new Error('archive fake rejects a bigint parameter (like postgres.js)');
        }
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

const AT = (iso: string): string => String(Date.parse(iso) * 1000);

describe('unread after a push wake stores a delivered mark (T-1361)', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let archiveClient: PGlite;

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive: pgliteArchivePool(archiveClient),
    });
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  it('keeps the newest message unread', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const owner = localpartFor(alice.id);
    const peer = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    const readAt = AT('2026-06-02T12:00:00.000Z');
    const newAt = AT('2026-06-03T12:00:00.000Z');
    const xml = (text: string): string =>
      `<message type="chat" from="${peer}/phone"><body>${text}</body></message>`;
    // Alice read up to test 11; test 12 arrived while the app was killed.
    await archiveClient.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'chat', '', $7),
              ($1, $8, $3, $4, $9, $10, 'chat', '', $11)`,
      [
        owner,
        readAt,
        `${peer}/phone`,
        peer,
        xml('read'),
        'read',
        'test-11',
        newAt,
        xml('push test 12'),
        'push test 12',
        'test-12',
      ],
    );
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_reads (user_id, chat_jid, last_read_id, updated_at)
          VALUES (${alice.id}, ${peer}, ${readAt}, now())`;
        // The headless wake's preview forked this delivered mark (T-1257).
        yield* sql`INSERT INTO chat_deliveries (user_id, chat_jid, delivered_id, updated_at)
          VALUES (${alice.id}, ${peer}, ${newAt}, now())`;
      }),
    );

    const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const entry = (
      (await response.json()) as {
        chats: Array<{ chatJid: string; unread?: number; lastMessage?: { id: string } }>;
      }
    ).chats.find((chat) => chat.chatJid === peer);
    // The delivered mark does not decide unread; the read mark does.
    expect(entry?.unread).toBe(1);
    expect(entry?.lastMessage?.id).toBe('test-12');
  });
});
