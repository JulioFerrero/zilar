// The chat-list unread count and preview (T-1272): an album's photos count
// once and preview as "{count} photos". `unreadForChats` needs a database and
// an archive pool, so this tests the extracted pure counting step
// (`summarizeUnread`) the loop runs over one batch read.

import { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { ArchivePool, ArchiveRow, SearchOwner } from '../search/service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { afterForMark, newestUnskippedRow } from './unread';
import { summarizeUnread } from './unread';

const PEER = 'ana@zilar.test';
const OWN_LOCALPART = 'me';
const OWN_JID = 'me@zilar.test';
const DOMAIN = 'zilar.test';
const CHAT_JID = PEER;

type UnreadRows = Parameters<typeof summarizeUnread>[0];
type ChatThresholds = Parameters<typeof summarizeUnread>[1];

const ALLOWED: SearchOwner = {
  ownLocalpart: OWN_LOCALPART,
  dmPeers: [PEER],
  rooms: [],
  peerNames: new Map([[PEER, 'Ana']]),
};

const CHATS: ChatThresholds = [{ jid: CHAT_JID, scope: { kind: 'dm', peer: PEER }, after: '0' }];

const ROOM = `room@muc.${DOMAIN}`;
const ROOM_CHATS: ChatThresholds = [{ jid: ROOM, scope: { kind: 'room', room: ROOM }, after: '0' }];

function roomRow(originId: string, nick: string, barePeer: string): UnreadRows[number] {
  return {
    chatJid: ROOM,
    barePeer,
    kind: 'groupchat',
    nick,
    originId,
    timestamp: BigInt(Date.now()) * 1000n,
    text: 'hello',
    xml: `<message type="groupchat" from="${ROOM}/someone"><body>hello</body></message>`,
  };
}

function dmRow(originId: string, xml: string, text: string | null = null): UnreadRows[number] {
  return {
    chatJid: CHAT_JID,
    barePeer: PEER,
    kind: 'chat',
    nick: '',
    originId,
    timestamp: BigInt(Date.now()) * 1000n,
    text,
    xml,
  };
}

function albumXml(index: number, id = 'alb-1'): string {
  return `<message type="chat" from="${PEER}/phone"><album xmlns="urn:zilar:album:0" id="${id}" index="${index}" count="3"/></message>`;
}

function plainXml(): string {
  return `<message type="chat" from="${PEER}/phone"><body>hello</body></message>`;
}

function progressXml(): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>Searching</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"ai-bot@zilar.test","stage":"Searching"}}</agent></message>`;
}

function correctionXml(target: string): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>Working</body><replace xmlns="urn:xmpp:message-correct:0" id="${target}"/></message>`;
}

function retractionXml(target: string): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>…attempted to retract…</body><retract xmlns="urn:xmpp:message-retract:1" id="${target}"/></message>`;
}

describe('summarizeUnread', () => {
  it('counts a same-album run once and previews the photo count when newest', () => {
    const page: UnreadRows = [
      dmRow('p-2', albumXml(2)),
      dmRow('p-1', albumXml(1)),
      dmRow('p-0', albumXml(0)),
      dmRow('plain', plainXml(), 'hello'),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('3 photos');
    expect(answer[CHAT_JID]?.lastMessage?.id).toBe('p-2');
  });

  it('keeps a plain newest row as the preview', () => {
    const page: UnreadRows = [dmRow('plain', plainXml(), 'hello'), dmRow('p-0', albumXml(0))];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('hello');
  });

  it('counts two different albums separately', () => {
    const page: UnreadRows = [
      dmRow('b-2', albumXml(2, 'alb-b')),
      dmRow('b-1', albumXml(1, 'alb-b')),
      dmRow('a-0', albumXml(0, 'alb-a')),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
  });

  it('skips a card, its edit and its retraction: only the answer counts and previews', () => {
    // Newest first, like the batch read: the answer arrived last.
    const page: UnreadRows = [
      dmRow('answer', plainXml(), 'Here is the answer'),
      dmRow('retract', retractionXml('card')),
      dmRow('edit', correctionXml('card')),
      dmRow('card', progressXml()),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(1);
    expect(answer[CHAT_JID]?.lastMessage?.id).toBe('answer');
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('Here is the answer');
  });

  it('leaves the badge and the preview alone when the only new row is a card', () => {
    const page: UnreadRows = [dmRow('card', progressXml())];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    // No counted row and no preview: the fallback read below the mark supplies
    // the chat's newest real message (or none), never the card.
    expect(answer[CHAT_JID]).toBeUndefined();
  });

  it('walks past a card run to the newest real row, whatever the row order', () => {
    const base = BigInt(Date.now()) * 1000n;
    const at = (offset: bigint) => base + offset;
    // Deliberately out of order: the timestamp sort, not the input order, must
    // pick the newest real row (the answer that arrives after the card).
    const rows: UnreadRows = [
      { ...dmRow('older', plainXml(), 'older message'), timestamp: at(0n) },
      { ...dmRow('answer', plainXml(), 'the answer'), timestamp: at(5n) },
      { ...dmRow('card', progressXml()), timestamp: at(2n) },
      { ...dmRow('retract', retractionXml('card')), timestamp: at(4n) },
      { ...dmRow('edit', correctionXml('card')), timestamp: at(3n) },
    ];

    expect(newestUnskippedRow(rows, CHAT_JID)?.originId).toBe('answer');
  });

  it('does not count a room row whose nick is the caller but whose bare_peer is another user', () => {
    const page: UnreadRows = [roomRow('spoofed', OWN_LOCALPART, 'ana@zilar.test')];
    const names = new Map([['ana@zilar.test', 'Ana']]);

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID, names);

    expect(answer[ROOM]?.unread).toBe(1);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Ana');
  });

  it('counts a room row as the caller from bare_peer, not from a stranger nick', () => {
    const page: UnreadRows = [roomRow('mine', 'Pretender', OWN_JID)];
    const names = new Map([[OWN_JID, 'Me Myself']]);

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID, names);

    // The caller's own message never bumps the badge, even under a stolen nick.
    expect(answer[ROOM]?.unread).toBe(0);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Me Myself');
  });

  it('treats a legacy room row with no bare_peer as the caller by its nick', () => {
    const page: UnreadRows = [roomRow('legacy-mine', OWN_LOCALPART.toUpperCase(), '')];

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID);

    expect(answer[ROOM]?.unread).toBe(0);
  });

  it('falls back to the nick when no display name exists for the sender JID', () => {
    const page: UnreadRows = [roomRow('legacy', 'Legacy Nick', 'stranger@zilar.test')];

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID);

    expect(answer[ROOM]?.unread).toBe(1);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Legacy Nick');
  });
});

describe('afterForMark', () => {
  const floor = '1700000000000000';
  it('parses a numeric mark', () => {
    expect(afterForMark('1700000000000001', floor)).toBe('1700000000000001');
  });
  it('uses the floor when there is no mark', () => {
    expect(afterForMark(undefined, floor)).toBe(floor);
  });
  it('falls back to the floor for a legacy non-numeric mark instead of throwing', () => {
    expect(afterForMark('seen', floor)).toBe(floor);
  });
});

// A group in the chat list keeps its unread count and preview: `list.ts`
// built the unread scope with `kind: 'group'`, which matched neither arm of
// `UnreadScope` and dropped every unread mark on the floor.
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

describe('a group in the chat list keeps its unread and preview', () => {
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

  it('carries unread and lastMessage on the group entry', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const [bobAcct] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          localpart: string;
          jid: string;
        }>`SELECT localpart, jid FROM xmpp_accounts WHERE user_id = ${bob.id} LIMIT 1`;
      }),
    );
    if (bobAcct === undefined) throw new Error('missing xmpp account for sender');
    const ownerId = await seedUser(context);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: alice.id, role: 'member' },
      ],
      [],
    );
    const [group] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
          WHERE id = ${groupId} LIMIT 1`;
      }),
    );
    if (group === undefined) throw new Error('seeded group not found');
    const groupJid = `${group.roomLocalpart}@${context.config.xmpp.mucDomain}`.toLowerCase();
    const [topic] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
          WHERE id = ${generalTopicId} LIMIT 1`;
      }),
    );
    if (topic === undefined) throw new Error('seeded general topic not found');
    const roomJid = `${topic.roomLocalpart}@${context.config.xmpp.mucDomain}`;
    const sender = bobAcct.jid;
    const senderLocalpart = bobAcct.localpart;
    await archiveClient.query(
      `INSERT INTO archive (username, timestamp, peer, bare_peer, xml, txt, kind, nick, origin_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'groupchat', $7, $8)`,
      [
        roomJid,
        String(BigInt(Date.now() - 2 * 86_400_000) * 1000n),
        roomJid,
        sender,
        `<message type="groupchat" from="${roomJid}/${senderLocalpart}"><body>hello group</body></message>`,
        'hello group',
        senderLocalpart,
        'grp-1',
      ],
    );

    const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chats: Array<{
        chatJid: string;
        kind: string;
        unread?: number;
        lastMessage?: { id: string };
        topics?: Array<{ chatJid: string; unread?: number; lastMessage?: { id: string } }>;
      }>;
    };
    const entry = body.chats.find((chat) => chat.chatJid === groupJid);
    const general = entry?.topics?.find((topic) => topic.chatJid === roomJid);
    expect(general?.unread).toBe(1);
    expect(general?.lastMessage?.id).toBe('grp-1');
  });
});
