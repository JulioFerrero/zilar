import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import type { ArchivePool, ArchiveRow } from '../search/service';
import { extractLinks, extractMediaItems, indexChat } from './indexer';

// PGlite shapes the fake the way the real `archive` table is shaped (see
// docs/SEARCH_NOTES.md), copied from search.test.ts: username/timestamp/peer/
// bare_peer/xml/txt, kind chat/groupchat, nick, origin_id.
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

// A fake ArchivePool backed by a second PGlite. It runs the real
// parameterized query text, so chat scoping and the cursor are proven against
// SQL.
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
  timestamp: number;
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

// XML text escaping, the shape the real client serializes.
function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function agentElement(payload: unknown): string {
  return `<agent xmlns="urn:zilar:agent:0">${escapeXmlText(JSON.stringify(payload))}</agent>`;
}

function payloadMessage(payload: unknown, body?: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  const bodyXml = body === undefined ? '' : `<body>${escapeXmlText(body)}</body>`;
  return `<message type="chat"${fromAttr}>${agentElement(payload)}${bodyXml}<store xmlns="urn:xmpp:hints"/></message>`;
}

function textMessage(body: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  return `<message type="chat"${fromAttr}><body>${escapeXmlText(body)}</body></message>`;
}

function correctionMessage(targetId: string, body: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  return `<message type="chat"${fromAttr}><body>${escapeXmlText(body)}</body><replace xmlns="urn:xmpp:message-correct:0" id="${targetId}"/></message>`;
}

function retractMessage(targetId: string): string {
  return `<message type="chat"><body>This person attempted to retract a previous message.</body><retract xmlns="urn:xmpp:message-retract:1" id="${targetId}"/></message>`;
}

const ATTACHMENT = {
  v: 0,
  type: 'attachment',
  data: {
    kind: 'image',
    url: 'https://files.example/a.png',
    name: 'a.png',
    size: 1234,
    mime: 'image/png',
    width: 640,
    height: 480,
  },
};

const GIF = {
  v: 0,
  type: 'attachment',
  data: {
    kind: 'file',
    url: 'https://files.example/gif-1.mp4',
    name: 'gif-1.mp4',
    size: 999,
    mime: 'video/mp4',
  },
};

const VOICE = {
  v: 0,
  type: 'voice',
  data: {
    duration_ms: 4200,
    mime: 'audio/ogg',
    waveform: [1, 2, 3],
    url: 'https://files.example/v.ogg',
  },
};

function archiveRow(overrides: Partial<ArchiveRow> & Pick<ArchiveRow, 'xml'>): ArchiveRow {
  return {
    owner: 'alice',
    peer: 'bob@zilar.localhost/r',
    barePeer: 'bob@zilar.localhost',
    kind: 'chat',
    nick: '',
    originId: 'o-1',
    timestamp: 1_780_000_000_000_000,
    headline: '',
    body: '',
    ...overrides,
  };
}

describe('extractMediaItems', () => {
  it('extracts an image attachment with its metadata', () => {
    const items = extractMediaItems(archiveRow({ xml: payloadMessage(ATTACHMENT, 'look') }));
    expect(items).toEqual([
      {
        kind: 'image',
        url: 'https://files.example/a.png',
        name: 'a.png',
        mime: 'image/png',
        size: 1234,
        width: 640,
        height: 480,
      },
    ]);
  });

  it('extracts a file attachment', () => {
    const file = {
      v: 0,
      type: 'attachment',
      data: {
        kind: 'file',
        url: 'https://files.example/doc.pdf',
        name: 'doc.pdf',
        size: 7,
        mime: 'application/pdf',
      },
    };
    const items = extractMediaItems(archiveRow({ xml: payloadMessage(file) }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'file', name: 'doc.pdf', mime: 'application/pdf' });
  });

  it('overrides a gif-named video attachment to kind gif', () => {
    const items = extractMediaItems(archiveRow({ xml: payloadMessage(GIF) }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'gif', mime: 'video/mp4' });
  });

  it('extracts a voice note with duration and waveform', () => {
    const items = extractMediaItems(archiveRow({ xml: payloadMessage(VOICE) }));
    expect(items).toEqual([
      {
        kind: 'voice',
        url: 'https://files.example/v.ogg',
        mime: 'audio/ogg',
        durationMs: 4200,
        waveform: [1, 2, 3],
      },
    ]);
  });

  it('extracts every http(s) link from the body, trimming punctuation and taking the host', () => {
    const items = extractMediaItems(
      archiveRow({
        xml: textMessage('see https://example.com/a). and http://two.test/x?y=1.'),
        body: 'see https://example.com/a). and http://two.test/x?y=1.',
      }),
    );
    expect(items).toEqual([
      { kind: 'link', linkUrl: 'https://example.com/a', linkHost: 'example.com' },
      { kind: 'link', linkUrl: 'http://two.test/x?y=1', linkHost: 'two.test' },
    ]);
  });

  it('drops a URL whose authority has no letter or digit', () => {
    expect(extractLinks('broken https://-/x and https://example.com/ok')).toEqual([
      { url: 'https://example.com/ok', host: 'example.com' },
    ]);
  });

  it('gives only the links when the payload JSON is invalid', () => {
    const xml =
      '<message type="chat"><agent xmlns="urn:zilar:agent:0">{not json</agent><body>https://example.com/x</body></message>';
    const items = extractMediaItems(archiveRow({ xml, body: 'https://example.com/x' }));
    expect(items).toEqual([
      { kind: 'link', linkUrl: 'https://example.com/x', linkHost: 'example.com' },
    ]);
  });

  it('gives nothing for malformed XML or an unknown payload', () => {
    expect(extractMediaItems(archiveRow({ xml: 'not xml at all' }))).toEqual([]);
    expect(
      extractMediaItems(archiveRow({ xml: '<message><agent xmlns="urn:zilar:agent:0">' })),
    ).toEqual([]);
    const unknown = { v: 0, type: 'sticker', data: { url: 'https://files.example/s.png' } };
    expect(extractMediaItems(archiveRow({ xml: payloadMessage(unknown) }))).toEqual([]);
  });
});

describe('indexChat', () => {
  let context: TestContext;
  let archiveClient: PGlite;
  let archive: ArchivePool;

  const now = new Date('2026-06-01T00:00:00.000Z');
  const OWNER = 'alice';
  const PEER = 'bob@zilar.localhost';
  const at = (iso: string) => new Date(iso).getTime() * 1000;

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

  async function run(maxRows?: number) {
    return indexChat({
      archive,
      db: context.db,
      archiveOwner: OWNER,
      chatJid: PEER,
      scope: { kind: 'dm', peer: PEER },
      now,
      ...(maxRows === undefined ? {} : { maxRows }),
    });
  }

  interface MediaRow {
    messageId: string;
    kind: string;
    senderJid: string;
    ref: string;
    linkUrl: string | null;
    linkHost: string | null;
    deleted: boolean;
    atMicros: number;
  }

  // at_micros is a bigint: the cast reads it back as a number.
  async function rowsForChat() {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<MediaRow>`SELECT message_id, kind, sender_jid, ref, link_url, link_host, deleted, at_micros::float8 FROM media_items WHERE chat_jid = ${PEER}`;
      }),
    );
  }

  it('inserts the extracted items and is idempotent on a second run', async () => {
    await seedArchive(archiveClient, [
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-img',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'caption',
        xml: payloadMessage(ATTACHMENT, 'caption', `${PEER}/r1`),
      },
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-voice',
        timestamp: at('2026-05-02T00:00:00Z'),
        txt: '',
        xml: payloadMessage(VOICE, undefined, `${PEER}/r1`),
      },
    ]);

    const first = await run();
    expect(first).toEqual({ read: 2, inserted: 2, done: true });

    const rows = await rowsForChat();
    expect(rows.map((row) => row.kind).sort()).toEqual(['image', 'voice']);
    const image = rows.find((row) => row.kind === 'image');
    expect(image?.messageId).toBe('o-img');
    expect(image?.senderJid).toBe(`${PEER}/r1`);
    expect(image?.ref).toBe('https://files.example/a.png');

    const state = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          indexedThroughMicros: number;
        }>`SELECT indexed_through_micros::float8 FROM media_index_state WHERE chat_jid = ${PEER}`;
      }),
    );
    expect(state[0]?.indexedThroughMicros).toBe(at('2026-05-02T00:00:00Z'));

    const second = await run();
    expect(second).toEqual({ read: 0, inserted: 0, done: true });
    expect(await rowsForChat()).toHaveLength(2);
  });

  it('dedups through the unique key when the cursor is forced back', async () => {
    await seedArchive(archiveClient, [
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'caption',
        xml: payloadMessage(ATTACHMENT, 'caption', `${PEER}/r1`),
      },
    ]);

    expect(await run()).toEqual({ read: 1, inserted: 1, done: true });

    // Force the cursor back to the window start so the same archive row is read
    // again: the unique key, not the cursor, must dedup it.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE media_index_state SET indexed_through_micros = 0 WHERE chat_jid = ${PEER}`;
      }),
    );

    expect(await run()).toEqual({ read: 1, inserted: 0, done: true });
    expect(await rowsForChat()).toHaveLength(1);
  });

  it('never reads older than the 12-month window', async () => {
    await seedArchive(archiveClient, [
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-old',
        timestamp: at('2024-01-01T00:00:00Z'),
        txt: 'caption',
        xml: payloadMessage(ATTACHMENT, 'caption'),
      },
    ]);
    const result = await run();
    expect(result.read).toBe(0);
    expect(await rowsForChat()).toHaveLength(0);
  });

  it('indexes only the requested room', async () => {
    const room = 'general@rooms.zilar.localhost';
    const otherRoom = 'random@rooms.zilar.localhost';
    await seedArchive(archiveClient, [
      {
        owner: room,
        peer: `${room}/alice`,
        barePeer: `${room}/alice`,
        kind: 'groupchat',
        nick: 'Alice',
        originId: 'room-img',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'caption',
        xml: payloadMessage(ATTACHMENT, 'caption'),
      },
      {
        owner: otherRoom,
        peer: `${otherRoom}/bob`,
        barePeer: `${otherRoom}/bob`,
        kind: 'groupchat',
        nick: 'Bob',
        originId: 'other-img',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'caption',
        xml: payloadMessage(ATTACHMENT, 'caption'),
      },
    ]);

    const result = await indexChat({
      archive,
      db: context.db,
      archiveOwner: room,
      chatJid: room,
      scope: { kind: 'room', room },
      now,
    });
    expect(result).toEqual({ read: 1, inserted: 1, done: true });

    const roomRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          messageId: string;
        }>`SELECT message_id FROM media_items WHERE chat_jid = ${room}`;
      }),
    );
    expect(roomRows.map((row) => row.messageId)).toEqual(['room-img']);

    const otherRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          messageId: string;
        }>`SELECT message_id FROM media_items WHERE chat_jid = ${otherRoom}`;
      }),
    );
    expect(otherRows).toHaveLength(0);
  });

  it('replaces the target links on a correction', async () => {
    await seedArchive(archiveClient, [
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'old https://example.com/old',
        xml: textMessage('old https://example.com/old', `${PEER}/r1`),
      },
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'c-1',
        timestamp: at('2026-05-02T00:00:00Z'),
        txt: 'new https://example.com/new',
        xml: correctionMessage('o-1', 'new https://example.com/new', `${PEER}/r1`),
      },
    ]);

    const result = await run();
    expect(result.read).toBe(2);
    const rows = await rowsForChat();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: 'o-1',
      kind: 'link',
      linkUrl: 'https://example.com/new',
      linkHost: 'example.com',
    });
  });

  it('marks every row of a retracted message deleted', async () => {
    await seedArchive(archiveClient, [
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: at('2026-05-01T00:00:00Z'),
        txt: 'look https://example.com/x',
        xml: payloadMessage(ATTACHMENT, 'look https://example.com/x', `${PEER}/r1`),
      },
      {
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat',
        nick: '',
        originId: 'r-1',
        timestamp: at('2026-05-02T00:00:00Z'),
        txt: 'This person attempted to retract a previous message.',
        xml: retractMessage('o-1'),
      },
    ]);

    await run();
    const rows = await rowsForChat();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deleted)).toBe(true);
    expect(rows.some((row) => row.messageId === 'r-1')).toBe(false);
  });

  it('prunes the oldest rows down to the cap', async () => {
    const times = [
      '2026-05-01T00:00:00Z',
      '2026-05-02T00:00:00Z',
      '2026-05-03T00:00:00Z',
      '2026-05-04T00:00:00Z',
      '2026-05-05T00:00:00Z',
    ];
    await seedArchive(
      archiveClient,
      times.map((iso, index) => ({
        owner: OWNER,
        peer: `${PEER}/r1`,
        barePeer: PEER,
        kind: 'chat' as const,
        nick: '',
        originId: `o-${index}`,
        timestamp: at(iso),
        txt: '',
        xml: payloadMessage(
          {
            ...ATTACHMENT,
            data: { ...ATTACHMENT.data, url: `https://files.example/${index}.png` },
          },
          undefined,
          `${PEER}/r1`,
        ),
      })),
    );

    await run(3);
    const rows = await rowsForChat();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.atMicros).sort((a, b) => a - b)).toEqual([
      at('2026-05-03T00:00:00Z'),
      at('2026-05-04T00:00:00Z'),
      at('2026-05-05T00:00:00Z'),
    ]);
  });
});
