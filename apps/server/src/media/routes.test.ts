import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { localpartFor } from '../xmpp/provisioning';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestContext,
} from '../test-support';
import type { ArchivePool, ArchiveRow } from '../search/service';

// PGlite shapes the fake the way the real `archive` table is shaped, copied
// from search.test.ts / indexer.test.ts.
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

function payloadMessage(payload: unknown, body?: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  const bodyXml = body === undefined ? '' : `<body>${escapeXmlText(body)}</body>`;
  return `<message type="chat"${fromAttr}><agent xmlns="urn:zilar:agent:0">${escapeXmlText(JSON.stringify(payload))}</agent>${bodyXml}<store xmlns="urn:xmpp:hints"/></message>`;
}

function textMessage(body: string, from?: string): string {
  const fromAttr = from === undefined ? '' : ` from="${from}"`;
  return `<message type="chat"${fromAttr}><body>${escapeXmlText(body)}</body></message>`;
}

function retractMessage(targetId: string): string {
  return `<message type="chat"><body>This person attempted to retract a previous message.</body><retract xmlns="urn:xmpp:message-retract:1" id="${targetId}"/></message>`;
}

const IMAGE = {
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

const FILE = {
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

const NOW_MS = Date.parse('2026-06-01T00:00:00.000Z');

function at(iso: string): number {
  return Date.parse(iso) * 1000;
}

interface MediaBody {
  items: Array<{
    messageId: string;
    chat: string;
    at: string;
    senderName: string;
    kind: string;
    url?: string;
    name?: string;
    size?: number;
    mime?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    waveform?: number[];
    linkUrl?: string;
    linkHost?: string;
  }>;
  next: string | null;
  error?: { code: string };
}

describe('GET /api/media', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let archiveClient: PGlite;
  let archive: ArchivePool;
  let now = NOW_MS;

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
      searchNow: () => now,
    });
    now = NOW_MS;
  });

  afterEach(async () => {
    await context.close();
    await archiveClient.close();
  });

  async function media(
    cookie: string | undefined,
    params: string,
  ): Promise<{ status: number; body: MediaBody }> {
    const response = await app.request(`${TEST_BASE_URL}/api/media${params}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
    return { status: response.status, body: (await response.json()) as MediaBody };
  }

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function createTopic(cookie: string, groupId: string, body: unknown) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; chatJid: string };
  }

  async function renameUser(cookie: string, name: string) {
    const response = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(200);
  }

  async function setupDm() {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await renameUser(alice.cookie, 'Alice');
    await renameUser(bob.cookie, 'Bob');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    return { alice, bob, stranger };
  }

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  it('answers 401 without a session', async () => {
    const { status } = await media(undefined, '?chat=someone@zilar.localhost');
    expect(status).toBe(401);
  });

  it('answers 501 without an archive', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const plain = testApp(context);
    const response = await plain.request(`${TEST_BASE_URL}/api/media?chat=${dmJid(alice.id)}`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(501);
    expect(((await response.json()) as MediaBody).error?.code).toBe('media_unavailable');
  });

  it('answers 404 for an unknown chat, a stranger DM, and a private topic', async () => {
    const { alice, bob, stranger } = await setupDm();
    const group = await createGroup(alice.cookie, 'Team', [bob.id]);
    const secret = await createTopic(alice.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [],
    });

    expect((await media(alice.cookie, '?chat=nobody@zilar.localhost')).status).toBe(404);
    expect((await media(alice.cookie, `?chat=${dmJid(stranger.id)}`)).status).toBe(404);
    expect((await media(bob.cookie, `?chat=${encodeURIComponent(secret.chatJid)}`)).status).toBe(
      404,
    );
  });

  it('answers 404 for a blocked DM in either direction', async () => {
    const { alice, bob } = await setupDm();
    const peer = dmJid(bob.id);

    const block = await app.request(`${TEST_BASE_URL}/api/blocks/${bob.id}`, {
      method: 'PUT',
      headers: { cookie: alice.cookie },
    });
    expect(block.status).toBe(200);
    expect((await media(alice.cookie, `?chat=${peer}`)).status).toBe(404);
    expect((await media(bob.cookie, `?chat=${dmJid(alice.id)}`)).status).toBe(404);

    const unblock = await app.request(`${TEST_BASE_URL}/api/blocks/${bob.id}`, {
      method: 'DELETE',
      headers: { cookie: alice.cookie },
    });
    expect(unblock.status).toBe(200);

    const reverse = await app.request(`${TEST_BASE_URL}/api/blocks/${alice.id}`, {
      method: 'PUT',
      headers: { cookie: bob.cookie },
    });
    expect(reverse.status).toBe(200);
    expect((await media(alice.cookie, `?chat=${peer}`)).status).toBe(404);
  });

  it('returns each kind under its own type, with media as the default', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-img',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/phone`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-file',
        timestamp: at('2026-05-02T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(FILE, undefined, `${peer}/phone`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-link',
        timestamp: at('2026-05-03T00:00:00.000Z'),
        txt: 'see https://example.com/a',
        xml: textMessage('see https://example.com/a', `${peer}/phone`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-voice',
        timestamp: at('2026-05-04T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(VOICE, undefined, `${peer}/phone`),
      },
    ]);

    const mediaDefault = await media(alice.cookie, `?chat=${peer}`);
    expect(mediaDefault.status).toBe(200);
    expect(mediaDefault.body.items.map((item) => item.kind)).toEqual(['image']);
    const image = mediaDefault.body.items[0];
    expect(image).toMatchObject({
      messageId: 'o-img',
      chat: peer,
      at: '2026-05-01T00:00:00.000Z',
      kind: 'image',
      url: 'https://files.example/a.png',
      name: 'a.png',
      size: 1234,
      mime: 'image/png',
      width: 640,
      height: 480,
    });
    expect(image?.linkUrl).toBeUndefined();

    const files = await media(alice.cookie, `?chat=${peer}&type=files`);
    expect(files.body.items.map((item) => item.kind)).toEqual(['file']);
    expect(files.body.items[0]?.name).toBe('doc.pdf');

    const links = await media(alice.cookie, `?chat=${peer}&type=links`);
    expect(links.body.items).toEqual([
      {
        messageId: 'o-link',
        chat: peer,
        at: '2026-05-03T00:00:00.000Z',
        senderName: 'Bob',
        kind: 'link',
        linkUrl: 'https://example.com/a',
        linkHost: 'example.com',
      },
    ]);

    const voice = await media(alice.cookie, `?chat=${peer}&type=voice`);
    expect(voice.body.items[0]).toMatchObject({
      kind: 'voice',
      url: 'https://files.example/v.ogg',
      mime: 'audio/ogg',
      durationMs: 4200,
      waveform: [1, 2, 3],
    });
  });

  it('pages with a before cursor and a limit', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-1',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/p`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-2',
        timestamp: at('2026-05-02T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/p`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-3',
        timestamp: at('2026-05-03T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/p`),
      },
    ]);

    const first = await media(alice.cookie, `?chat=${peer}&limit=1`);
    expect(first.body.items.map((item) => item.messageId)).toEqual(['o-3']);
    expect(first.body.next).toBe(String(at('2026-05-03T00:00:00.000Z')));

    const second = await media(alice.cookie, `?chat=${peer}&limit=1&before=${first.body.next}`);
    expect(second.body.items.map((item) => item.messageId)).toEqual(['o-2']);
    expect(second.body.next).toBe(String(at('2026-05-02T00:00:00.000Z')));

    const third = await media(alice.cookie, `?chat=${peer}&limit=1&before=${second.body.next}`);
    expect(third.body.items.map((item) => item.messageId)).toEqual(['o-1']);
    expect(third.body.next).toBeNull();
  });

  it('never returns a retracted image', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const peer = dmJid(bob.id);
    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-img',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/p`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-retract',
        timestamp: at('2026-05-02T00:00:00.000Z'),
        txt: 'This person attempted to retract a previous message.',
        xml: retractMessage('o-img'),
      },
    ]);

    const { status, body } = await media(alice.cookie, `?chat=${peer}`);
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.next).toBeNull();
  });

  it('names senders: You for mine, the peer for theirs, the nick in a room', async () => {
    const { alice, bob } = await setupDm();
    const own = localpartFor(alice.id);
    const ownJid = dmJid(alice.id);
    const peer = dmJid(bob.id);
    const group = await createGroup(alice.cookie, 'Team', [bob.id]);
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          roomLocalpart: string;
        }>`SELECT room_localpart FROM groups WHERE id = ${group.id}`;
      }),
    );
    const generalJid = `${groupRow?.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;

    await seedArchive(archiveClient, [
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-mine',
        timestamp: at('2026-05-03T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${ownJid}/desk`),
      },
      {
        owner: own,
        peer: `${peer}/r1`,
        barePeer: peer,
        kind: 'chat',
        nick: '',
        originId: 'o-theirs',
        timestamp: at('2026-05-02T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${peer}/phone`),
      },
      {
        owner: generalJid,
        peer: 'someone@x/r',
        barePeer: 'someone@x',
        kind: 'groupchat',
        nick: 'AliceNick',
        originId: 'o-room',
        timestamp: at('2026-05-01T00:00:00.000Z'),
        txt: '',
        xml: payloadMessage(IMAGE, undefined, `${generalJid}/AliceNick`),
      },
    ]);

    const dm = await media(alice.cookie, `?chat=${peer}`);
    expect(dm.body.items.map((item) => [item.senderName, item.messageId])).toEqual([
      ['You', 'o-mine'],
      ['Bob', 'o-theirs'],
    ]);

    const room = await media(alice.cookie, `?chat=${encodeURIComponent(generalJid)}`);
    expect(room.body.items.map((item) => item.senderName)).toEqual(['AliceNick']);
  });

  it('answers 400 for a bad type, an out-of-range limit, or a missing chat', async () => {
    const { alice, bob } = await setupDm();
    const peer = dmJid(bob.id);
    expect((await media(alice.cookie, `?chat=${peer}&type=photos`)).status).toBe(400);
    expect((await media(alice.cookie, `?chat=${peer}&limit=101`)).status).toBe(400);
    expect((await media(alice.cookie, `?chat=${peer}&limit=0`)).status).toBe(400);
    expect((await media(alice.cookie, '?type=media')).status).toBe(400);
  });

  it('answers 429 after 30 requests a minute', async () => {
    const { alice, bob } = await setupDm();
    const peer = dmJid(bob.id);
    for (let i = 0; i < 30; i += 1) {
      const { status } = await media(alice.cookie, `?chat=${peer}`);
      expect(status).toBe(200);
    }
    const { status, body } = await media(alice.cookie, `?chat=${peer}`);
    expect(status).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
  });
});
