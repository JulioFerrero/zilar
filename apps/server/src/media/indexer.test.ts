import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArchivePool, ArchiveRow } from '../search/service';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { MEDIA_LINKS_PER_MESSAGE } from './extract';
import { indexChat } from './indexer';

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

const ROOM = 'team@conference.example.test';
// Occupant JIDs as the stanza's `from` (the free nick lives after the slash) and
// the real sender JIDs ejabberd stores in `bare_peer`.
const ALICE = `${ROOM}/alice`;
const MALLORY = `${ROOM}/mallory`;
const ALICE_JID = 'alice@example.test';
const MALLORY_JID = 'mallory@example.test';
const NOW = new Date('2026-06-01T00:00:00.000Z');
const FILE_URL = 'https://files.example.test/doc.pdf';

const FILE_PAYLOAD = {
  v: 0,
  type: 'attachment',
  data: {
    kind: 'file',
    url: FILE_URL,
    name: 'doc.pdf',
    size: 11,
    mime: 'application/pdf',
  },
};

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

// Fails the second-pass author lookup (the only query that filters one origin
// id) while the pass read still works, like a transient archive-pool error.
function failingAuthorLookupPool(pool: ArchivePool): ArchivePool {
  return {
    query: (async (text: string, values: unknown[]) => {
      if (text.includes('origin_id =')) {
        throw new Error('archive pool unavailable');
      }
      return pool.query(text, values);
    }) as ArchivePool['query'],
    close: async () => {},
  };
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

interface MessageInput {
  from: string;
  /** The real sender, as ejabberd archives it; defaults from `from`. */
  barePeer?: string;
  body?: string;
  attachment?: unknown;
  replace?: string;
  retract?: string;
}

function realSenderOf(from: string): string {
  if (from === ALICE) return ALICE_JID;
  if (from === MALLORY) return MALLORY_JID;
  return ROOM;
}

function messageXml(input: MessageInput): string {
  const agent =
    input.attachment === undefined
      ? ''
      : `<agent xmlns="urn:zilar:agent:0">${escapeXmlText(JSON.stringify(input.attachment))}</agent>`;
  const body = input.body === undefined ? '' : `<body>${escapeXmlText(input.body)}</body>`;
  const replace =
    input.replace === undefined
      ? ''
      : `<replace xmlns="urn:xmpp:message-correct:0" id="${input.replace}"/>`;
  const retract =
    input.retract === undefined
      ? ''
      : `<retract xmlns="urn:xmpp:message-retract:1" id="${input.retract}"/>`;
  return `<message type="groupchat" from="${input.from}">${agent}${body}${replace}${retract}<store xmlns="urn:xmpp:hints"/></message>`;
}

interface SeedMessage extends MessageInput {
  originId: string;
  atMicros: number;
}

function seedRow(input: SeedMessage): ArchiveRow {
  return {
    owner: ROOM,
    peer: ROOM,
    barePeer: input.barePeer ?? realSenderOf(input.from),
    kind: 'groupchat',
    nick: '',
    originId: input.originId,
    timestamp: input.atMicros,
    headline: '',
    body: input.body ?? '',
    xml: messageXml(input),
  };
}

async function seedArchive(client: PGlite, rows: ArchiveRow[]): Promise<void> {
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
        row.body ?? null,
        row.kind,
        row.nick,
        row.originId,
      ],
    );
  }
}

function at(iso: string): number {
  return Date.parse(iso) * 1000;
}

describe('media indexer', () => {
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

  function runIndex(
    options: {
      maxRows?: number;
      archive?: ArchivePool;
      logger?: { warn: (details: unknown) => void };
    } = {},
  ) {
    return indexChat({
      archive: options.archive ?? archive,
      db: context.db,
      archiveOwner: ROOM,
      chatJid: ROOM,
      scope: { kind: 'room', room: ROOM },
      now: NOW,
      ...options,
    });
  }

  async function itemsOf(messageId: string) {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ kind: string; senderJid: string; deleted: boolean }>`
          SELECT kind, sender_jid, deleted FROM media_items
          WHERE archive_owner = ${ROOM} AND chat_jid = ${ROOM}
            AND message_id = ${messageId}
          ORDER BY kind, ref`;
      }),
    );
  }

  async function cursor() {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ indexedThroughMicros: string }>`
          SELECT indexed_through_micros FROM media_index_state
          WHERE archive_owner = ${ROOM} AND chat_jid = ${ROOM}`;
      }),
    );
    const stored = rows[0]?.indexedThroughMicros;
    return stored === undefined ? undefined : BigInt(stored);
  }

  it('a retraction from another sender leaves the victim row visible', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-1',
        atMicros: at('2026-05-01T00:00:00.000Z'),
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
      seedRow({
        originId: 'mallory-1',
        atMicros: at('2026-05-01T00:01:00.000Z'),
        from: MALLORY,
        retract: 'alice-1',
      }),
    ]);

    const result = await runIndex();

    expect(result.read).toBe(2);
    expect(await itemsOf('alice-1')).toEqual([
      { kind: 'file', senderJid: ALICE_JID, deleted: false },
    ]);
  });

  it('the victim own retraction hides the row', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-2',
        atMicros: at('2026-05-01T00:00:00.000Z'),
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
      seedRow({
        originId: 'alice-3',
        atMicros: at('2026-05-01T00:01:00.000Z'),
        from: ALICE,
        retract: 'alice-2',
      }),
    ]);

    await runIndex();

    expect(await itemsOf('alice-2')).toEqual([
      { kind: 'file', senderJid: ALICE_JID, deleted: true },
    ]);
  });

  it('a correction from another sender inserts nothing', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-4',
        atMicros: at('2026-05-01T00:00:00.000Z'),
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
      seedRow({
        originId: 'mallory-2',
        atMicros: at('2026-05-01T00:01:00.000Z'),
        from: MALLORY,
        body: 'https://evil.example.test/link',
        replace: 'alice-4',
      }),
    ]);

    await runIndex();

    expect(await itemsOf('alice-4')).toEqual([
      { kind: 'file', senderJid: ALICE_JID, deleted: false },
    ]);
  });

  it('a correction from another bare_peer with the same nick leaves the target alone', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-spoof',
        atMicros: at('2026-05-01T02:00:00.000Z'),
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
      seedRow({
        originId: 'mallory-spoof',
        atMicros: at('2026-05-01T02:01:00.000Z'),
        // She joined with Alice's nick, but the archive knows her real JID.
        from: ALICE,
        barePeer: MALLORY_JID,
        body: 'https://evil.example.test/spoof',
        replace: 'alice-spoof',
      }),
    ]);

    await runIndex();

    expect(await itemsOf('alice-spoof')).toEqual([
      { kind: 'file', senderJid: ALICE_JID, deleted: false },
    ]);
    expect(await itemsOf('mallory-spoof')).toEqual([]);
  });

  it('a foreign correction of a text-only message inserts nothing', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-text',
        atMicros: at('2026-05-04T00:00:00.000Z'),
        from: ALICE,
        body: 'no links here',
      }),
    ]);
    await runIndex();

    await seedArchive(archiveClient, [
      seedRow({
        originId: 'mallory-3',
        atMicros: at('2026-05-04T00:01:00.000Z'),
        from: MALLORY,
        body: 'https://evil.example.test/text',
        replace: 'alice-text',
      }),
    ]);
    const result = await runIndex();

    expect(result.inserted).toBe(0);
    expect(await itemsOf('alice-text')).toEqual([]);
  });

  it('the author own correction of a text-only message inserts its links', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-text-own',
        atMicros: at('2026-05-04T01:00:00.000Z'),
        from: ALICE,
        body: 'no links here',
      }),
      seedRow({
        originId: 'alice-edit-own',
        atMicros: at('2026-05-04T01:01:00.000Z'),
        from: ALICE,
        body: 'https://example.test/own',
        replace: 'alice-text-own',
      }),
    ]);

    await runIndex();

    expect(await itemsOf('alice-text-own')).toEqual([
      { kind: 'link', senderJid: ALICE_JID, deleted: false },
    ]);
  });

  it('an archive failure during a correction is logged and skipped', async () => {
    const textAt = at('2026-05-05T00:00:00.000Z');
    const editAt = at('2026-05-05T00:01:00.000Z');
    const fileAt = at('2026-05-05T00:02:00.000Z');
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-text-fail',
        atMicros: textAt,
        from: ALICE,
        body: 'no links here',
      }),
    ]);
    await runIndex();

    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-edit-fail',
        atMicros: editAt,
        from: ALICE,
        body: 'https://example.test/fail',
        replace: 'alice-text-fail',
      }),
      seedRow({
        originId: 'alice-after-fail',
        atMicros: fileAt,
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
    ]);

    const skipped: unknown[] = [];
    const result = await runIndex({
      archive: failingAuthorLookupPool(archive),
      logger: {
        warn: (details) => {
          skipped.push(details);
        },
      },
    });

    expect(result.inserted).toBe(1);
    expect(skipped).toEqual([{ messageId: 'alice-edit-fail', err: 'Error' }]);
    expect(await itemsOf('alice-text-fail')).toEqual([]);
    expect(await itemsOf('alice-after-fail')).toEqual([
      { kind: 'file', senderJid: ALICE_JID, deleted: false },
    ]);
    expect(await cursor()).toBe(BigInt(fileAt));
  });

  it('indexes at most 50 links of a message and moves the cursor on', async () => {
    const timestamp = at('2026-05-02T00:00:00.000Z');
    const body = Array.from({ length: 3000 }, (_, index) => `https://example.test/${index}`).join(
      ' ',
    );
    await seedArchive(archiveClient, [
      seedRow({ originId: 'alice-links', atMicros: timestamp, from: ALICE, body }),
    ]);

    const result = await runIndex();

    const items = await itemsOf('alice-links');
    expect(items).toHaveLength(MEDIA_LINKS_PER_MESSAGE);
    expect(items.every((item) => item.kind === 'link')).toBe(true);
    expect(result.inserted).toBe(MEDIA_LINKS_PER_MESSAGE);
    expect(await cursor()).toBe(BigInt(timestamp));
  });

  it('the per-chat cap prunes links only', async () => {
    await seedArchive(archiveClient, [
      seedRow({
        originId: 'alice-file',
        atMicros: at('2026-05-03T00:00:00.000Z'),
        from: ALICE,
        attachment: FILE_PAYLOAD,
      }),
      seedRow({
        originId: 'alice-l1',
        atMicros: at('2026-05-03T00:01:00.000Z'),
        from: ALICE,
        body: 'https://example.test/1',
      }),
      seedRow({
        originId: 'alice-l2',
        atMicros: at('2026-05-03T00:02:00.000Z'),
        from: ALICE,
        body: 'https://example.test/2',
      }),
      seedRow({
        originId: 'alice-l3',
        atMicros: at('2026-05-03T00:03:00.000Z'),
        from: ALICE,
        body: 'https://example.test/3',
      }),
    ]);

    await runIndex({ maxRows: 2 });

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ kind: string; messageId: string }>`
          SELECT kind, message_id FROM media_items
          WHERE archive_owner = ${ROOM} AND chat_jid = ${ROOM}
          ORDER BY at_micros ASC, message_id ASC`;
      }),
    );

    expect(rows.map((row) => row.kind)).toEqual(['file', 'link', 'link']);
    expect(rows.filter((row) => row.kind === 'link')).toHaveLength(2);
    expect(rows[0]?.messageId).toBe('alice-file');
  });
});
