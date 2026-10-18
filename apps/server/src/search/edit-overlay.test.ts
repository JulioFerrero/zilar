import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { loadEditsForTargets } from './edit-overlay';
import { runSearchEffect } from './routes';
import type { ArchivePool, ArchiveRow } from './service';

// T-2003: corrections and retractions resolve through one helper. It must use
// the target's sender, and its edits read must not carry the page cursor: a
// retraction that landed after page 1 still hides a page-2 message.

const TS = 1_780_000_000_000_000n;

function at(offset: bigint): bigint {
  return TS + offset * 1_000_000n;
}

function row(overrides: Partial<ArchiveRow> & { originId: string; timestamp: bigint }): ArchiveRow {
  return {
    owner: 'alice',
    peer: 'bob@zilar.localhost',
    barePeer: 'bob@zilar.localhost',
    kind: 'chat',
    nick: '',
    headline: '',
    xml: '<message type="chat" from="bob@zilar.localhost/phone"><body>x</body></message>',
    body: '',
    ...overrides,
  };
}

function retraction(target: string, from: string, timestamp: bigint): ArchiveRow {
  return row({
    originId: `retract-${target}`,
    timestamp,
    body: '…attempted to retract…',
    xml: `<message type="chat" from="${from}"><retract xmlns="urn:xmpp:message-retract:1" id="${target}"/></message>`,
  });
}

function correction(target: string, from: string, timestamp: bigint, body: string): ArchiveRow {
  return row({
    originId: `edit-${target}-${timestamp}`,
    timestamp,
    body,
    xml: `<message type="chat" from="${from}"><body>${body}</body><replace xmlns="urn:xmpp:message-correct:0" id="${target}"/></message>`,
  });
}

function fakeArchive(
  targets: ArchiveRow[],
  edits: ArchiveRow[],
): { pool: ArchivePool; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    pool: {
      query: async (text: string) => {
        queries.push(text);
        return (text.includes('xml LIKE') ? edits : targets) as ArchiveRow[];
      },
      close: async () => {},
    },
  };
}

const DM = { kind: 'dm', owner: 'alice', peer: 'bob@zilar.localhost' } as const;
const ROOM = { kind: 'room', room: 'room@zilar.localhost' } as const;

function roomRow(
  overrides: Partial<ArchiveRow> & { originId: string; timestamp: bigint },
): ArchiveRow {
  return row({
    owner: ROOM.room,
    peer: ROOM.room,
    kind: 'groupchat',
    nick: 'Bob',
    xml: `<message type="groupchat" from="${ROOM.room}/Bob"><body>x</body></message>`,
    ...overrides,
  });
}

describe('loadEditsForTargets', () => {
  it('marks a retraction from the target’s sender as retracted', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [retraction('m1', 'bob@zilar.localhost/phone', at(20n))],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toEqual({ retracted: true });
  });

  it('ignores a retraction from another sender', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [retraction('m1', 'carol@zilar.localhost/phone', at(20n))],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });

  it('keeps the newest correction text from the original sender', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [
        correction('m1', 'bob@zilar.localhost/phone', at(30n), 'second'),
        correction('m1', 'bob@zilar.localhost/phone', at(20n), 'first'),
      ],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toEqual({ retracted: false, latestText: 'second' });
  });

  it('ignores a correction from another sender', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [correction('m1', 'carol@zilar.localhost/phone', at(20n), 'forged')],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });

  it('reads edits without the page cursor or the search window', async () => {
    const { pool, queries } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [retraction('m1', 'bob@zilar.localhost/phone', at(900n))],
    );

    await loadEditsForTargets(pool, DM, ['m1']);

    const editQuery = queries.find((text) => text.includes('xml LIKE')) ?? '';
    expect(editQuery).not.toContain('timestamp <');
  });

  it('drops a room retraction with the target nick but another bare_peer', async () => {
    const { pool } = fakeArchive(
      [roomRow({ originId: 'm1', timestamp: at(10n), barePeer: 'bob@zilar.localhost' })],
      [
        roomRow({
          originId: 'retract-m1',
          timestamp: at(20n),
          barePeer: 'carol@zilar.localhost',
          nick: 'Bob',
          body: '…attempted to retract…',
          xml: `<message type="groupchat" from="${ROOM.room}/Bob"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>`,
        }),
      ],
    );

    const overlay = await loadEditsForTargets(pool, ROOM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });

  it('applies a room retraction from the same bare_peer', async () => {
    const { pool } = fakeArchive(
      [roomRow({ originId: 'm1', timestamp: at(10n), barePeer: 'bob@zilar.localhost' })],
      [
        roomRow({
          originId: 'retract-m1',
          timestamp: at(20n),
          barePeer: 'bob@zilar.localhost',
          nick: 'Mallory',
          body: '…attempted to retract…',
          xml: `<message type="groupchat" from="${ROOM.room}/Mallory"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>`,
        }),
      ],
    );

    const overlay = await loadEditsForTargets(pool, ROOM, ['m1']);

    expect(overlay.get('m1')).toEqual({ retracted: true });
  });

  it('ignores a forged muc#user item on a room edit from another bare_peer', async () => {
    const { pool } = fakeArchive(
      [roomRow({ originId: 'm1', timestamp: at(10n), barePeer: 'bob@zilar.localhost' })],
      [
        roomRow({
          originId: 'edit-m1',
          timestamp: at(20n),
          barePeer: 'carol@zilar.localhost',
          nick: 'Bob',
          body: 'forged',
          xml: `<message type="groupchat" from="${ROOM.room}/Bob"><body>forged</body><replace xmlns="urn:xmpp:message-correct:0" id="m1"/><x xmlns="http://jabber.org/protocol/muc#user"><item jid="bob@zilar.localhost"/></x></message>`,
        }),
      ],
    );

    const overlay = await loadEditsForTargets(pool, ROOM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });
});

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

async function seedArchive(
  client: PGlite,
  rows: Array<{
    owner: string;
    peer: string;
    originId: string;
    timestamp: bigint;
    body: string;
    xml: string;
  }>,
): Promise<void> {
  for (const entry of rows) {
    await client.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'chat', '', $7)`,
      [
        entry.owner,
        entry.timestamp.toString(),
        entry.peer,
        entry.peer,
        entry.xml,
        entry.body,
        entry.originId,
      ],
    );
  }
}

describe('search retractions', () => {
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

  async function setup() {
    const app = testApp(context);
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const bobJid = expectedJid(bob.id);
    const owner = localpartFor(alice.id);
    return { alice, bobJid, owner };
  }

  function search(aliceId: string, chat: string, before?: number, q = 'secretword') {
    return Effect.runPromise(
      runSearchEffect(
        {
          auth: context.auth,
          db: context.db,
          config: context.config,
          logger: context.logger,
          archive,
        },
        aliceId,
        { q, chat, ...(before === undefined ? {} : { before }) },
      ),
    );
  }

  function message(owner: string, peer: string, originId: string, timestamp: bigint) {
    return {
      owner,
      peer,
      originId,
      timestamp,
      body: 'secretword here',
      xml: `<message type="chat" from="${peer}/phone"><body>secretword here</body></message>`,
    };
  }

  it('hides a page-2 hit retracted after the page cursor', async () => {
    const { alice, bobJid, owner } = await setup();
    await seedArchive(archiveClient, [
      message(owner, bobJid, 'm1', at(100n)),
      message(owner, bobJid, 'm2', at(300n)),
      {
        owner,
        peer: bobJid,
        originId: 'retract-m1',
        timestamp: at(400n),
        body: '…attempted to retract…',
        xml: `<message type="chat" from="${bobJid}/phone"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>`,
      },
    ]);

    // Page 2: rows older than the page-1 cursor at 300. The retraction at 400
    // is newer than the cursor and must still hide m1.
    const result = await search(alice.id, bobJid, Number(at(300n)));

    expect(result.items).toEqual([]);
  });

  it('hides a retracted hit that only the fuzzy pass matches', async () => {
    const { alice, bobJid, owner } = await setup();
    await seedArchive(archiveClient, [
      {
        owner,
        peer: bobJid,
        originId: 'm1',
        timestamp: at(100n),
        body: 'Meet at noon tomorrow',
        xml: `<message type="chat" from="${bobJid}/phone"><body>Meet at noon tomorrow</body></message>`,
      },
      {
        owner,
        peer: bobJid,
        originId: 'retract-m1',
        timestamp: at(200n),
        body: '…attempted to retract…',
        xml: `<message type="chat" from="${bobJid}/phone"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>`,
      },
    ]);

    // "noom" misses the exact tsvector pass but is one edit from "noon", so
    // the typo-tolerant pass finds the row; the retraction must still hide it.
    const result = await search(alice.id, bobJid, undefined, 'meet noom');

    expect(result.items).toEqual([]);
  });

  it('ignores a retraction from another sender in search', async () => {
    const { alice, bobJid, owner } = await setup();
    await seedArchive(archiveClient, [
      message(owner, bobJid, 'm1', at(100n)),
      {
        owner,
        peer: bobJid,
        originId: 'retract-m1',
        timestamp: at(200n),
        body: '…attempted to retract…',
        xml: '<message type="chat" from="carol@zilar.localhost/phone"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>',
      },
    ]);

    const result = await search(alice.id, bobJid);

    expect(result.items.map((item) => item.messageId)).toEqual(['m1']);
  });
});
