import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { createAuthApi } from './api';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchivePool, ArchiveRow } from '../search/service';

// T-1262: `GET /me/export`. These cover the archive scoping (the caller's own
// rows only), the fresh-session gate, the one-per-hour rate limit and the
// §6a document shape. The streamed body and the size caps are server-side.

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
  kind: 'chat' | 'groupchat';
  originId: string;
  timestamp: number;
  body: string;
  from: string;
}

async function seedArchive(client: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8)`,
      [
        row.owner,
        row.timestamp,
        row.peer,
        row.peer,
        `<message type="chat" from="${row.from}"><body>${row.body}</body></message>`,
        row.body,
        row.kind,
        row.originId,
      ],
    );
  }
}

function at(iso: string): number {
  return Date.parse(iso) * 1000;
}

interface ExportMessage {
  id: string;
  at: string;
  from: string;
  body: string;
  kind: string;
}

interface ExportChat {
  jid: string;
  kind: string;
  messages: ExportMessage[];
}

interface ExportDocument {
  exportedAt: string;
  profile: { id: string; name: string; handle: string | null; bio: string };
  contacts: Array<{ userId: string; name: string; jid: string }>;
  chats: ExportChat[];
  truncated?: boolean;
}

interface ErrorBody {
  error: { code: string; message: string };
}

describe('GET /api/me/export', () => {
  let context: TestContext;
  let archiveClient: PGlite;
  let archive: ArchivePool;

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    archive = pgliteArchivePool(archiveClient);
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  // The export route lives on the auth group; mount it standalone so the test
  // can inject the fake archive, exactly like `files/routes.test.ts` does.
  function exportTarget(): (cookie: string) => Promise<Response> {
    const api = createAuthApi({
      auth: context.auth,
      db: context.db,
      config: context.config,
      adminClient: context.adminClient,
      logger: context.logger,
      archive,
    });
    return (cookie: string) =>
      api.handler(new Request(`${TEST_BASE_URL}/api/me/export`, { headers: { cookie } }));
  }

  async function exportDocument(
    target: (cookie: string) => Promise<Response>,
    cookie: string,
  ): Promise<ExportDocument> {
    const response = await target(cookie);
    expect(response.status).toBe(200);
    return (await response.json()) as ExportDocument;
  }

  it("exports only the caller's own archive rows", async () => {
    const app = testApp(context);
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const aliceJid = expectedJid(alice.id);
    const bobJid = expectedJid(bob.id);
    await seedArchive(archiveClient, [
      // Alice's own DM archive row.
      {
        owner: localpartFor(alice.id),
        peer: bobJid,
        kind: 'chat',
        originId: 'alice-1',
        timestamp: at('2026-05-01T10:00:00Z'),
        body: 'hello alice',
        from: bobJid,
      },
      // Bob's own DM row: it must never appear in Alice's export.
      {
        owner: localpartFor(bob.id),
        peer: aliceJid,
        kind: 'chat',
        originId: 'bob-1',
        timestamp: at('2026-05-01T10:01:00Z'),
        body: 'hello bob',
        from: aliceJid,
      },
    ]);

    const document = await exportDocument(exportTarget(), alice.cookie);
    const ids = document.chats.flatMap((chat) => chat.messages.map((message) => message.id));
    expect(ids).toContain('alice-1');
    expect(ids).not.toContain('bob-1');
  });

  it('answers 403 reauth_required for a session older than 30 minutes', async () => {
    const app = testApp(context);
    const alice = await bootstrapUser(context, app, 'stale@example.com');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE "session" SET created_at = (now() AT TIME ZONE 'UTC') - interval '31 minutes' WHERE user_id = ${alice.id}`;
      }),
    );

    const response = await exportTarget()(alice.cookie);
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('reauth_required');
    expect(body.error.message).toBe('Sign in again to export your messages.');
  });

  it('answers 429 rate_limited on a second export within the hour', async () => {
    const app = testApp(context);
    const alice = await bootstrapUser(context, app, 'rate@example.com');
    const target = exportTarget();

    const first = await target(alice.cookie);
    expect(first.status).toBe(200);
    await first.text();

    const second = await target(alice.cookie);
    expect(second.status).toBe(429);
    const body = (await second.json()) as ErrorBody;
    expect(body.error.code).toBe('rate_limited');
  });

  it('parses as §6a JSON and maps a DM from to me/them', async () => {
    const app = testApp(context);
    const alice = await bootstrapUser(context, app, 'shape@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob-two@example.com');
    const aliceJid = expectedJid(alice.id);
    const bobJid = expectedJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: localpartFor(alice.id),
        peer: bobJid,
        kind: 'chat',
        originId: 'them-1',
        timestamp: at('2026-05-02T10:00:00Z'),
        body: 'good morning',
        from: bobJid,
      },
      {
        owner: localpartFor(alice.id),
        peer: bobJid,
        kind: 'chat',
        originId: 'me-1',
        timestamp: at('2026-05-02T10:01:00Z'),
        body: 'good morning to you',
        from: aliceJid,
      },
    ]);

    const document = await exportDocument(exportTarget(), alice.cookie);
    expect(typeof document.exportedAt).toBe('string');
    expect(document.profile).toMatchObject({ id: alice.id });
    expect(Array.isArray(document.contacts)).toBe(true);
    expect(document.contacts).toContainEqual({
      userId: bob.id,
      name: expect.any(String),
      jid: bobJid,
    });
    expect(Array.isArray(document.chats)).toBe(true);
    const dm = document.chats.find((chat) => chat.kind === 'dm' && chat.jid === bobJid);
    expect(dm).toBeDefined();
    const messages = dm?.messages ?? [];
    expect(messages.every((message) => message.kind === 'text')).toBe(true);
    expect(messages.map((message) => message.from)).toEqual(['them', 'me']);
  });
});
