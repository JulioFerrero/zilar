import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ArchiveRow, SearchOwner } from '../search/service';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import { albumKey } from './album-key';
import { newestMessageForUserEffect, type ArchiveCandidate } from './archive-scan';
import { resolveCandidate } from './candidates';
import { buildNativeWakePayload, buildPushPayload } from './payload';
import type { PushServiceDeps } from './service';

// A fixed clock so the mute windows are exact: every `muted_until` is built
// relative to it, never to the wall clock.
const NOW = new Date('2026-06-01T12:00:00Z');

// `resolveCandidate` only reads `db`, `config` and `now`; the rest are stubs.
function buildDeps(context: TestContext, now: Date): PushServiceDeps {
  return {
    db: context.db,
    config: context.config,
    archive: { query: () => Promise.resolve([]), close: () => Promise.resolve() },
    cipher: { encrypt: (text) => text, decrypt: (envelope) => envelope },
    sender: { send: () => Promise.resolve({ gone: false }) },
    logger: { info: () => undefined, warn: () => undefined },
    recentlyNotified: new Map(),
    now: () => now,
  };
}

function ownerFor(userId: string): SearchOwner {
  return { ownLocalpart: localpartFor(userId), dmPeers: [], rooms: [], peerNames: new Map() };
}

function roomJid(context: TestContext, roomLocalpart: string): string {
  return `${roomLocalpart}@${context.config.xmpp.mucDomain}`.toLowerCase();
}

interface RoomRowOverrides {
  owner: string;
  nick?: string;
  barePeer?: string;
  originId?: string;
  text?: string | null;
  xml?: string;
}

// The archive row's `bare_peer` names a room sender's real JID; the push name
// comes from that user's `"user".name` (T-2004).
async function seedAccount(context: TestContext, userId: string): Promise<string> {
  const jid = `${localpartFor(userId)}@${context.config.xmpp.domain}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO xmpp_accounts (user_id, localpart, jid, provisioned)
        VALUES (${userId}, ${localpartFor(userId)}, ${jid}, true)`;
    }),
  );
  return jid;
}

// An archive row as the candidate read selects it: the pool's `ArchiveRow`
// plus the aliased `text` column (`txt AS text`) the scan reads.
type AlbumRow = ArchiveRow & { text: string | null };

function roomRow(overrides: RoomRowOverrides): ArchiveCandidate {
  return {
    owner: overrides.owner,
    barePeer: overrides.barePeer ?? '',
    kind: 'groupchat',
    nick: overrides.nick ?? 'Someone',
    originId: overrides.originId ?? 'origin-1',
    timestamp: 0,
    text: overrides.text ?? 'hello',
    xml: overrides.xml ?? '<message><body>hello</body></message>',
  };
}

// One row of a DM multi-photo album: every photo carries the T-1267 marker
// with the same id and no caption.
function albumDmRow(userId: string, peer: string, index: number): AlbumRow {
  return {
    owner: localpartFor(userId),
    peer: `${peer}/phone`,
    barePeer: peer,
    kind: 'chat',
    nick: '',
    originId: `origin-${index}`,
    timestamp: BigInt(NOW.getTime()) * 1000n,
    headline: '',
    text: null,
    xml: `<message type="chat" from="${peer}/phone"><album xmlns="urn:zilar:album:0" id="alb-1" index="${index}" count="3"/></message>`,
  };
}

interface SeededTopic {
  id: string;
  roomLocalpart: string;
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
  name: string,
  visibility: 'public' | 'private',
): Promise<SeededTopic> {
  const id = randomUUID();
  const roomLocalpart = `t${randomBytes(15).toString('hex').slice(0, 15)}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name,
        glyph: 'T',
        room_localpart: roomLocalpart,
        visibility,
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: createdBy,
      })}`;
    }),
  );
  return { id, roomLocalpart };
}

async function groupGeneralRoomJid(context: TestContext, groupId: string): Promise<string> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
        WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (row === undefined) {
    throw new Error(`group ${groupId} was not seeded`);
  }
  return roomJid(context, row.roomLocalpart);
}

async function setGroupKind(
  context: TestContext,
  groupId: string,
  kind: 'group' | 'channel',
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE groups SET kind = ${kind} WHERE id = ${groupId}`;
    }),
  );
}

async function addTopicMember(
  context: TestContext,
  topicId: string,
  userId: string,
  addedBy: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
        VALUES (${topicId}, ${userId}, ${addedBy})`;
    }),
  );
}

async function setMute(
  context: TestContext,
  userId: string,
  chatJid: string,
  mutedUntil: Date,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO chat_prefs ${sql.insert({
        user_id: userId,
        chat_jid: chatJid,
        muted_until: mutedUntil,
      })}`;
    }),
  );
}

describe('resolveCandidate', () => {
  let context: TestContext;
  let deps: PushServiceDeps;

  beforeEach(async () => {
    context = await createTestContext();
    deps = buildDeps(context, NOW);
  });

  afterEach(async () => {
    await context.close();
  });

  it('skips a retraction row', async () => {
    const userId = await seedUser(context);
    const row = roomRow({
      owner: 'room@rooms.zilar.localhost',
      xml: '<message><retract xmlns="urn:xmpp:message-retract:1"/></message>',
    });
    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({ status: 'skip' });
  });

  it('skips a progress card', async () => {
    const userId = await seedUser(context);
    const peer = `ai-bot@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'progress-1',
      timestamp: 0,
      text: 'Searching the web',
      xml: `<message type="chat" from="${peer}/desk"><body>Searching the web</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"${peer}","stage":"Searching the web"}}</agent></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Helper']]) };
    expect(await resolveCandidate(deps, userId, allowed, row)).toEqual({ status: 'skip' });
  });

  it('skips a correction of a progress card', async () => {
    const userId = await seedUser(context);
    const peer = `ai-bot@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'progress-2',
      timestamp: 0,
      text: 'Working',
      xml: `<message type="chat" from="${peer}/desk"><body>Working</body><replace xmlns="urn:xmpp:message-correct:0" id="progress-1"/></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Helper']]) };
    expect(await resolveCandidate(deps, userId, allowed, row, new Set(['progress-1']))).toEqual({
      status: 'skip',
    });
  });

  it('notifies a normal AI message', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'answer-1',
      timestamp: 0,
      text: 'Here is the answer',
      xml: `<message type="chat" from="${peer}/desk"><body>Here is the answer</body></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Ana']]) };
    expect(await resolveCandidate(deps, userId, allowed, row, new Set(['progress-1']))).toEqual({
      status: 'ok',
      message: {
        chatJid: peer,
        chatKind: 'dm',
        senderName: 'Ana',
        place: 'Ana',
        text: 'Here is the answer',
        messageId: 'answer-1',
      },
    });
  });

  it("skips the user's own room row from bare_peer, whatever the nick says", async () => {
    const userId = await seedUser(context);
    const ownJid = await seedAccount(context, userId);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], []);
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: 'Someone Else',
      barePeer: ownJid,
    });
    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({ status: 'skip' });
  });

  it('skips a legacy own room row with no bare_peer by its nick', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], []);
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    // An old row has no real sender JID: its nick is the only signal.
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: localpartFor(userId).toUpperCase(),
    });

    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({ status: 'skip' });
  });

  it("notifies with the real sender's name when the nick is the caller's localpart", async () => {
    const userId = await seedUser(context, { name: 'Recipient' });
    const senderId = await seedUser(context, { name: 'Ana Sender' });
    const senderJid = await seedAccount(context, senderId);
    const { groupId } = await seedGroup(
      context,
      userId,
      [
        { userId, role: 'owner' },
        { userId: senderId, role: 'member' },
      ],
      [],
    );
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: localpartFor(userId),
      barePeer: senderJid,
    });

    const verdict = await resolveCandidate(deps, userId, ownerFor(userId), row);

    expect(verdict).toMatchObject({ status: 'ok', message: { senderName: 'Ana Sender' } });
  });

  it('ignores a forged muc#user item and trusts bare_peer', async () => {
    const userId = await seedUser(context, { name: 'Recipient' });
    const senderId = await seedUser(context, { name: 'Ana Sender' });
    const senderJid = await seedAccount(context, senderId);
    const ownJid = await seedAccount(context, userId);
    const { groupId } = await seedGroup(
      context,
      userId,
      [
        { userId, role: 'owner' },
        { userId: senderId, role: 'member' },
      ],
      [],
    );
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    // A stanza can claim any item JID; ejabberd stores no such item, and the
    // real sender is bare_peer.
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: 'Ana Sender',
      barePeer: senderJid,
      xml: `<message type="groupchat"><body>hello</body><x xmlns='http://jabber.org/protocol/muc#user'><item jid='${ownJid}'/></x></message>`,
    });

    const verdict = await resolveCandidate(deps, userId, ownerFor(userId), row);

    expect(verdict).toMatchObject({ status: 'ok', message: { senderName: 'Ana Sender' } });
  });

  it('skips a group message from a blocked sender', async () => {
    const userId = await seedUser(context);
    const senderId = await seedUser(context, { name: 'Blocked Sender' });
    const senderJid = await seedAccount(context, senderId);
    const { groupId } = await seedGroup(
      context,
      userId,
      [
        { userId, role: 'owner' },
        { userId: senderId, role: 'member' },
      ],
      [],
    );
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    // The block runs the other way: either direction is silent.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO user_blocks (user_id, blocked_user_id)
          VALUES (${senderId}, ${userId})`;
      }),
    );
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: 'Blocked Sender',
      barePeer: senderJid,
    });

    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({ status: 'skip' });
  });

  it('hides a private topic from a group member outside it and resolves it for a topic member', async () => {
    const ownerId = await seedUser(context);
    const memberId = await seedUser(context);
    const outsiderId = await seedUser(context);
    const strangerId = await seedUser(context);
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: memberId, role: 'member' },
        { userId: outsiderId, role: 'member' },
      ],
      [],
      { title: 'Team' },
    );
    const topic = await seedTopic(context, groupId, ownerId, 'Hiring', 'private');
    await addTopicMember(context, topic.id, memberId, ownerId);
    const row = roomRow({ owner: roomJid(context, topic.roomLocalpart) });

    // A group member who is not on the private topic's member list is hidden by
    // the private-topic check, not by the group-membership gate.
    expect(await resolveCandidate(deps, outsiderId, ownerFor(outsiderId), row)).toEqual({
      status: 'hidden',
    });
    expect(await resolveCandidate(deps, strangerId, ownerFor(strangerId), row)).toEqual({
      status: 'hidden',
    });
    expect(await resolveCandidate(deps, memberId, ownerFor(memberId), row)).toMatchObject({
      status: 'ok',
      message: { chatJid: roomJid(context, topic.roomLocalpart), place: 'Team › Hiring' },
    });
  });

  it('hides a public topic from a group member who has not joined it', async () => {
    const ownerId = await seedUser(context);
    const memberId = await seedUser(context);
    const outsiderId = await seedUser(context);
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: memberId, role: 'member' },
        { userId: outsiderId, role: 'member' },
      ],
      [],
      { title: 'Team' },
    );
    const topic = await seedTopic(context, groupId, ownerId, 'Backend', 'public');
    await addTopicMember(context, topic.id, memberId, ownerId);
    const row = roomRow({ owner: roomJid(context, topic.roomLocalpart), nick: 'Other' });

    // A public topic is visible to every group member, but only its members
    // get its pushes (T-1830).
    expect(await resolveCandidate(deps, outsiderId, ownerFor(outsiderId), row)).toEqual({
      status: 'hidden',
    });
    expect(await resolveCandidate(deps, memberId, ownerFor(memberId), row)).toMatchObject({
      status: 'ok',
      message: { chatJid: roomJid(context, topic.roomLocalpart), place: 'Team › Backend' },
    });
  });

  it('mutes a topic through its group General mute', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], [], {
      title: 'Team',
    });
    const topic = await seedTopic(context, groupId, userId, 'Backend', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    const generalJid = await groupGeneralRoomJid(context, groupId);
    await setMute(context, userId, generalJid, new Date(NOW.getTime() + 3_600_000));
    const row = roomRow({ owner: roomJid(context, topic.roomLocalpart), nick: 'Other' });
    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({
      status: 'muted',
    });
  });

  it('notifies a topic once its group General mute has expired', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], [], {
      title: 'Team',
    });
    const topic = await seedTopic(context, groupId, userId, 'Backend', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    const generalJid = await groupGeneralRoomJid(context, groupId);
    await setMute(context, userId, generalJid, new Date(NOW.getTime() - 3_600_000));
    const row = roomRow({ owner: roomJid(context, topic.roomLocalpart), nick: 'Other' });
    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({
      status: 'ok',
      message: {
        chatJid: roomJid(context, topic.roomLocalpart),
        chatKind: 'group',
        senderName: 'Other',
        place: 'Team › Backend',
        text: 'hello',
        messageId: 'origin-1',
      },
    });
  });

  it('previews a reply without its fallback quote line', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    // The archived text keeps the wire `> quote` head; the row's XML marks
    // it with the XEP-0461 fallback range (start and end in code points).
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'origin-reply',
      timestamp: 0,
      text: '> old\nmy reply',
      xml: `<message from="${peer}/phone"><body>&gt; old\nmy reply</body><reply xmlns="urn:xmpp:reply:0" id="m-1"/><fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0"><body start="2" end="5"/></fallback></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Ana']]) };
    expect(await resolveCandidate(deps, userId, allowed, row)).toEqual({
      status: 'ok',
      message: {
        chatJid: peer,
        chatKind: 'dm',
        senderName: 'Ana',
        place: 'Ana',
        text: 'my reply',
        messageId: 'origin-reply',
      },
    });
  });

  it('keeps the text when the reply fallback range does not parse', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'origin-broken',
      timestamp: 0,
      text: '> old\nmy reply',
      xml: `<message from="${peer}/phone"><body>&gt; old\nmy reply</body><fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0"><body start="nope"/></fallback></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Ana']]) };
    expect(await resolveCandidate(deps, userId, allowed, row)).toMatchObject({
      status: 'ok',
      message: { text: '> old\nmy reply' },
    });
  });

  it('marks a 3-photo album once: one candidate, both siblings notified', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    // Newest first, like the archive read; every photo carries the marker.
    const rows: AlbumRow[] = [2, 1, 0].map((index) => albumDmRow(userId, peer, index));
    const scanDeps: PushServiceDeps = {
      ...deps,
      archive: { query: () => Promise.resolve(rows), close: () => Promise.resolve() },
    };

    const scan = await Effect.runPromise(newestMessageForUserEffect(scanDeps, userId, 'node-1'));

    expect(scan.newest?.message.albumCount).toBe(3);
    expect(new Set(scan.notify)).toEqual(new Set(['origin-0', 'origin-1', 'origin-2']));
  });

  it('shows the photo count as the album body', () => {
    const payload = buildPushPayload(
      {
        chatJid: 'ana@zilar.localhost',
        chatKind: 'dm',
        senderName: 'Ana',
        place: 'Ana',
        text: undefined,
        messageId: 'origin-1',
        albumId: 'alb-1',
        albumCount: 3,
      },
      { muted: false, visible: true, showPreviews: true },
    );
    expect(payload?.body).toBe('3 photos');
  });

  it('treats a malformed album marker as a single photo', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'origin-broken',
      timestamp: 0,
      text: null,
      // `count="1"` breaks the §1.4 bound, so the marker is dropped.
      xml: `<message type="chat" from="${peer}/phone"><album xmlns="urn:zilar:album:0" id="alb-1" index="0" count="1"/></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Ana']]) };

    const verdict = await resolveCandidate(deps, userId, allowed, row);

    expect(verdict.status).toBe('ok');
    if (verdict.status !== 'ok') {
      return;
    }
    expect(verdict.message.albumCount).toBeUndefined();
    const payload = buildPushPayload(verdict.message, {
      muted: false,
      visible: true,
      showPreviews: true,
    });
    expect(payload?.body).toBe('New message');
  });

  it('sends nothing for an album sibling that lands after delivery', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    const row = albumDmRow(userId, peer, 2);
    const delivered = {
      chatJid: peer,
      chatKind: 'dm',
      senderName: 'Someone',
      place: 'Someone',
      text: undefined,
      albumId: 'alb-1',
    } as const;
    const scanDeps: PushServiceDeps = {
      ...deps,
      archive: { query: () => Promise.resolve([row]), close: () => Promise.resolve() },
      recentlyNotified: new Map([['node-1', new Set([albumKey(delivered) ?? ''])]]),
    };

    const scan = await Effect.runPromise(newestMessageForUserEffect(scanDeps, userId, 'node-1'));

    expect(scan.newest).toBeUndefined();
    expect(scanDeps.recentlyNotified.get('node-1')?.has('origin-2')).toBe(true);
  });

  it('marks a DM candidate as a dm', async () => {
    const userId = await seedUser(context);
    const peer = `ana@${context.config.xmpp.domain}`;
    const row: ArchiveCandidate = {
      owner: localpartFor(userId),
      barePeer: peer,
      kind: 'chat',
      nick: '',
      originId: 'origin-dm',
      timestamp: 0,
      text: 'hi',
      xml: `<message type="chat" from="${peer}/phone"><body>hi</body></message>`,
    };
    const allowed: SearchOwner = { ...ownerFor(userId), peerNames: new Map([[peer, 'Ana']]) };

    const verdict = await resolveCandidate(deps, userId, allowed, row);

    expect(verdict).toMatchObject({ status: 'ok', message: { chatKind: 'dm' } });
  });

  it('marks a channel room as a channel and carries it in the native wake', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], [], {
      title: 'News',
    });
    await setGroupKind(context, groupId, 'channel');
    const topic = await seedTopic(context, groupId, userId, 'Feed', 'public');
    await addTopicMember(context, topic.id, userId, userId);
    const room = roomJid(context, topic.roomLocalpart);
    const row = roomRow({ owner: room, nick: 'Other' });

    const verdict = await resolveCandidate(deps, userId, ownerFor(userId), row);

    expect(verdict).toMatchObject({ status: 'ok', message: { chatKind: 'channel' } });
    if (verdict.status !== 'ok') {
      return;
    }
    const wake = buildNativeWakePayload(
      verdict.message,
      { muted: false, visible: true, showPreviews: true },
      context.config.xmpp.domain,
    );
    expect(wake).toMatchObject({
      chatId: room,
      chatKind: 'channel',
      serverId: context.config.xmpp.domain,
    });
  });
});
