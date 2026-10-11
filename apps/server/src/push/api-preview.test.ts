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
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.owner,
        Date.parse('2026-06-01T00:00:00.000Z') * 1000,
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
    expect(json).toEqual({ title: 'Bob', body: 'Hello there', chatId: peer });
  });

  it('answers the generic body when previews are off', async () => {
    const { alice, peer } = await setupDm();
    await setShowPreviews(alice.id, false);
    await seedArchive(archiveClient, [
      dmRow(localpartFor(alice.id), peer, 'origin-2', 'Secret text'),
    ]);

    const { status, json } = await preview(alice.cookie, 'origin-2');

    expect(status).toBe(200);
    expect(json).toEqual({ title: 'Bob', body: 'New message', chatId: peer });
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
        barePeer: '',
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

  it('answers 401 without a session', async () => {
    const { status } = await preview(undefined, 'origin-1');

    expect(status).toBe(401);
  });
});
