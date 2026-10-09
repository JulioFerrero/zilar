import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../../test-support';
import type { ArchivePool, ArchiveRow } from '../../search/service';
import { indexMemory } from './indexer';

interface MemoryMessageRow {
  seq: number;
  messageId: string;
  sender: string;
  text: string;
  at: Date;
  deleted: boolean;
}

interface MemoryNodeRow {
  lo: number;
  hi: number;
  summary: string;
}

// PGlite shapes the fake the way the real `archive` table is shaped (see
// docs/SEARCH_NOTES.md), copied from media/indexer.test.ts: username/timestamp/
// peer/bare_peer/xml/txt, kind chat/groupchat, nick, origin_id.
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

const STICKER = {
  v: 0,
  type: 'sticker',
  data: {
    pack_id: '223e4567-e89b-12d3-a456-426614174000',
    sticker_id: '223e4567-e89b-12d3-a456-426614174001',
    url: 'https://files.example/s.webp',
    width: 128,
    height: 128,
    mime: 'image/webp',
  },
};

const OWNER = 'alice';
const OWNER_BARE = `${OWNER}@zilar.localhost`;
const OTHER_BARE = 'bob@zilar.localhost';
const AI_LOCALPART = 'helper';
const AI_BARE = `${AI_LOCALPART}@zilar.localhost`;
const ROOM = 'general@rooms.zilar.localhost';
const DM_CHAT_KEY = `dm:${OWNER_BARE}`;
const ROOM_CHAT_KEY = `room:${ROOM}`;

const at = (iso: string) => new Date(iso).getTime() * 1000;

describe('indexMemory', () => {
  let context: TestContext;
  let archiveClient: PGlite;
  let archive: ArchivePool;
  let aiId: string;

  const now = new Date('2026-06-01T00:00:00.000Z');

  function dmSeed(originId: string, iso: string, body: string, xml: string): SeedRow {
    return {
      owner: AI_LOCALPART,
      peer: `${OWNER_BARE}/phone`,
      barePeer: OWNER_BARE,
      kind: 'chat',
      nick: '',
      originId,
      timestamp: at(iso),
      txt: body,
      xml,
    };
  }

  function roomSeed(
    originId: string,
    iso: string,
    nick: string,
    body: string,
    xml: string,
  ): SeedRow {
    const resource = nick.toLowerCase();
    return {
      owner: ROOM,
      peer: `${ROOM}/${resource}`,
      barePeer: `${ROOM}/${resource}`,
      kind: 'groupchat',
      nick,
      originId,
      timestamp: at(iso),
      txt: body,
      xml,
    };
  }

  beforeEach(async () => {
    context = await createTestContext();
    archiveClient = new PGlite();
    await archiveClient.exec(ARCHIVE_DDL);
    archive = pgliteArchivePool(archiveClient);

    const ownerId = randomUUID();
    const connectionId = randomUUID();
    aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" ${sql.insert({
          id: ownerId,
          name: 'Alice',
          email: `${ownerId}@example.com`,
        })}`;
        yield* sql`INSERT INTO provider_connections ${sql.insert({
          id: connectionId,
          owner: ownerId,
          provider: 'openai',
          encrypted_key: 'sealed-placeholder',
          label: null,
        })}`;
        yield* sql`INSERT INTO ais ${sql.insert({
          id: aiId,
          owner: ownerId,
          name: 'Helper',
          template: 'dev',
          persona: 'A persona',
          provider_connection_id: connectionId,
          model: 'gpt-4o-mini',
          localpart: AI_LOCALPART,
          jid: AI_BARE,
          status: 'active',
        })}`;
      }),
    );
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  function runDM(ownerName?: string) {
    return indexMemory({
      archive,
      db: context.db,
      aiId,
      chatKey: DM_CHAT_KEY,
      archiveOwner: AI_LOCALPART,
      scope: { kind: 'dm', peer: OWNER_BARE },
      aiBareJid: AI_BARE,
      ...(ownerName === undefined ? {} : { ownerName }),
      now,
    });
  }

  function runRoom() {
    return indexMemory({
      archive,
      db: context.db,
      aiId,
      chatKey: ROOM_CHAT_KEY,
      archiveOwner: ROOM,
      scope: { kind: 'room', room: ROOM },
      aiBareJid: AI_BARE,
      now,
    });
  }

  async function rowsFor(chatKey: string): Promise<readonly MemoryMessageRow[]> {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<MemoryMessageRow>`SELECT seq, message_id, sender, text, at, deleted
          FROM ai_memory_messages WHERE ai_id = ${aiId} AND chat_key = ${chatKey}
          ORDER BY seq`;
      }),
    );
  }

  async function nodesFor(chatKey: string): Promise<readonly MemoryNodeRow[]> {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<MemoryNodeRow>`SELECT lo, hi, summary
          FROM ai_memory_nodes WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
      }),
    );
  }

  it('mirrors a DM in order, with dense seqs and AI/owner senders', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-1', '2026-05-01T00:00:00Z', 'hello', textMessage('hello', `${OWNER_BARE}/phone`)),
      dmSeed('o-2', '2026-05-02T00:00:00Z', 'hi there', textMessage('hi there', `${AI_BARE}/desk`)),
      dmSeed('o-3', '2026-05-03T00:00:00Z', 'bye', textMessage('bye', `${OWNER_BARE}/phone`)),
    ]);

    const result = await runDM('Alice');
    expect(result).toEqual({ read: 3, inserted: 3, done: true });

    const stored = await rowsFor(DM_CHAT_KEY);
    expect(stored.map((row) => row.seq)).toEqual([0, 1, 2]);
    expect(stored.map((row) => row.messageId)).toEqual(['o-1', 'o-2', 'o-3']);
    expect(stored.map((row) => row.sender)).toEqual(['Alice', 'AI', 'Alice']);
    expect(stored.map((row) => row.text)).toEqual(['hello', 'hi there', 'bye']);
    expect(stored[0]?.at.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(stored.every((row) => !row.deleted)).toBe(true);

    const [state] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          indexedThroughMicros: number;
        }>`SELECT indexed_through_micros::float8 AS indexed_through_micros
          FROM ai_memory_state WHERE ai_id = ${aiId} AND chat_key = ${DM_CHAT_KEY}`;
      }),
    );
    expect(state?.indexedThroughMicros).toBe(at('2026-05-03T00:00:00Z'));
  });

  it('defaults the DM sender to Owner when no name is given', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-1', '2026-05-01T00:00:00Z', 'hello', textMessage('hello', `${OWNER_BARE}/phone`)),
    ]);

    await runDM();
    expect((await rowsFor(DM_CHAT_KEY))[0]?.sender).toBe('Owner');
  });

  it('mirrors a room using nicks as senders', async () => {
    await seedArchive(archiveClient, [
      roomSeed(
        'r-1',
        '2026-05-01T00:00:00Z',
        'Alice',
        'hello',
        textMessage('hello', `${ROOM}/alice`),
      ),
      roomSeed('r-2', '2026-05-02T00:00:00Z', 'Bob', 'hey', textMessage('hey', `${ROOM}/bob`)),
    ]);

    const result = await runRoom();
    expect(result).toEqual({ read: 2, inserted: 2, done: true });

    const stored = await rowsFor(ROOM_CHAT_KEY);
    expect(stored.map((row) => row.sender)).toEqual(['Alice', 'Bob']);
    expect(stored.map((row) => row.seq)).toEqual([0, 1]);
  });

  it('inserts nothing on a second pass, and nothing when the cursor is forced back', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-1', '2026-05-01T00:00:00Z', 'hello', textMessage('hello', `${OWNER_BARE}/phone`)),
    ]);

    expect(await runDM()).toEqual({ read: 1, inserted: 1, done: true });
    // The cursor stops the second pass before the archive.
    expect(await runDM()).toEqual({ read: 0, inserted: 0, done: true });

    // The unique key, not the cursor, dedups a forced-back read.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_memory_state SET indexed_through_micros = 0
          WHERE ai_id = ${aiId} AND chat_key = ${DM_CHAT_KEY}`;
      }),
    );
    expect(await runDM()).toEqual({ read: 1, inserted: 0, done: true });
    expect(await rowsFor(DM_CHAT_KEY)).toHaveLength(1);
  });

  it('turns media into placeholders and skips an empty row', async () => {
    await seedArchive(archiveClient, [
      dmSeed(
        'o-img',
        '2026-05-01T00:00:00Z',
        'look',
        payloadMessage(ATTACHMENT, 'look', `${OWNER_BARE}/phone`),
      ),
      dmSeed(
        'o-voice',
        '2026-05-02T00:00:00Z',
        '',
        payloadMessage(VOICE, undefined, `${AI_BARE}/desk`),
      ),
      dmSeed(
        'o-gif',
        '2026-05-03T00:00:00Z',
        '',
        payloadMessage(GIF, undefined, `${OWNER_BARE}/phone`),
      ),
      dmSeed(
        'o-sticker',
        '2026-05-04T00:00:00Z',
        '',
        payloadMessage(STICKER, undefined, `${AI_BARE}/desk`),
      ),
      dmSeed(
        'o-link',
        '2026-05-05T00:00:00Z',
        'see https://example.com/x',
        textMessage('see https://example.com/x', `${OWNER_BARE}/phone`),
      ),
      dmSeed('o-empty', '2026-05-06T00:00:00Z', '', textMessage('', `${OWNER_BARE}/phone`)),
    ]);

    const result = await runDM();
    expect(result).toEqual({ read: 6, inserted: 5, done: true });

    const stored = await rowsFor(DM_CHAT_KEY);
    expect(stored.map((row) => row.messageId)).toEqual([
      'o-img',
      'o-voice',
      'o-gif',
      'o-sticker',
      'o-link',
    ]);
    expect(stored.map((row) => row.text)).toEqual([
      '[image: a.png] look',
      '[voice 0:04]',
      '[gif]',
      '[sticker]',
      'see https://example.com/x',
    ]);
  });

  it('cuts stored text to 1000 characters', async () => {
    const long = 'x'.repeat(1200);
    await seedArchive(archiveClient, [
      dmSeed('o-1', '2026-05-01T00:00:00Z', long, textMessage(long, `${OWNER_BARE}/phone`)),
    ]);

    await runDM();
    const stored = await rowsFor(DM_CHAT_KEY);
    expect(stored[0]?.text).toHaveLength(1000);
  });

  it('replaces the target text on a correction, dropping only covering nodes', async () => {
    await seedArchive(archiveClient, [
      dmSeed(
        'o-1',
        '2026-05-01T00:00:00Z',
        'old text',
        textMessage('old text', `${OWNER_BARE}/phone`),
      ),
      dmSeed('o-2', '2026-05-02T00:00:00Z', 'other', textMessage('other', `${AI_BARE}/desk`)),
      dmSeed(
        'c-1',
        '2026-05-03T00:00:00Z',
        'new text',
        correctionMessage('o-1', 'new text', `${OWNER_BARE}/phone`),
      ),
    ]);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ai_memory_nodes ${sql.insert([
          { ai_id: aiId, chat_key: DM_CHAT_KEY, lo: 0, hi: 16, summary: 'covers' },
          { ai_id: aiId, chat_key: DM_CHAT_KEY, lo: 16, hi: 32, summary: 'stays' },
        ])}`;
      }),
    );

    const result = await runDM();
    expect(result).toEqual({ read: 3, inserted: 2, done: true });

    const stored = await rowsFor(DM_CHAT_KEY);
    expect(stored.map((row) => row.messageId).sort()).toEqual(['o-1', 'o-2']);
    expect(stored.find((row) => row.messageId === 'o-1')?.text).toBe('new text');
    expect(stored.some((row) => row.messageId === 'c-1')).toBe(false);

    const nodes = await nodesFor(DM_CHAT_KEY);
    expect(nodes.map((node) => `${node.lo}-${node.hi}`)).toEqual(['16-32']);
    expect(nodes[0]?.summary).toBe('stays');
  });

  it('marks a retracted message deleted and blanks its text, dropping covering nodes', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-1', '2026-05-01T00:00:00Z', 'secret', textMessage('secret', `${OWNER_BARE}/phone`)),
      dmSeed('r-1', '2026-05-02T00:00:00Z', '', retractMessage('o-1')),
    ]);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ai_memory_nodes ${sql.insert({
          ai_id: aiId,
          chat_key: DM_CHAT_KEY,
          lo: 0,
          hi: 16,
          summary: 'gone',
        })}`;
      }),
    );

    const result = await runDM();
    expect(result).toEqual({ read: 2, inserted: 1, done: true });

    const stored = await rowsFor(DM_CHAT_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ messageId: 'o-1', deleted: true, text: '' });
    expect(stored.some((row) => row.messageId === 'r-1')).toBe(false);
    expect(await nodesFor(DM_CHAT_KEY)).toHaveLength(0);
  });

  it('never reads older than the 12-month window', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-old', '2024-01-01T00:00:00Z', 'old', textMessage('old', `${OWNER_BARE}/phone`)),
    ]);

    const result = await runDM();
    expect(result).toEqual({ read: 0, inserted: 0, done: true });
    expect(await rowsFor(DM_CHAT_KEY)).toHaveLength(0);
  });

  it('never mirrors another chat', async () => {
    await seedArchive(archiveClient, [
      dmSeed('o-mine', '2026-05-01T00:00:00Z', 'mine', textMessage('mine', `${OWNER_BARE}/phone`)),
      {
        owner: AI_LOCALPART,
        peer: `${OTHER_BARE}/phone`,
        barePeer: OTHER_BARE,
        kind: 'chat',
        nick: '',
        originId: 'o-other',
        timestamp: at('2026-05-02T00:00:00Z'),
        txt: 'other',
        xml: textMessage('other', `${OTHER_BARE}/phone`),
      },
    ]);

    const result = await runDM();
    expect(result).toEqual({ read: 1, inserted: 1, done: true });
    expect((await rowsFor(DM_CHAT_KEY)).map((row) => row.messageId)).toEqual(['o-mine']);
  });
});
