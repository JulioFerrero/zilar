import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { SearchOwner } from '../search/service';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchiveCandidate } from './archive-scan';
import { resolveCandidate } from './candidates';
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
  originId?: string;
  text?: string | null;
  xml?: string;
}

function roomRow(overrides: RoomRowOverrides): ArchiveCandidate {
  return {
    owner: overrides.owner,
    barePeer: '',
    kind: 'groupchat',
    nick: overrides.nick ?? 'Someone',
    originId: overrides.originId ?? 'origin-1',
    timestamp: 0,
    text: overrides.text ?? 'hello',
    xml: overrides.xml ?? '<message><body>hello</body></message>',
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

  it('skips a room message from the user', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], []);
    const topic = await seedTopic(context, groupId, userId, 'Chat', 'public');
    const row = roomRow({
      owner: roomJid(context, topic.roomLocalpart),
      nick: localpartFor(userId),
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

  it('mutes a topic through its group General mute', async () => {
    const userId = await seedUser(context);
    const { groupId } = await seedGroup(context, userId, [{ userId, role: 'owner' }], [], {
      title: 'Team',
    });
    const topic = await seedTopic(context, groupId, userId, 'Backend', 'public');
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
    const generalJid = await groupGeneralRoomJid(context, groupId);
    await setMute(context, userId, generalJid, new Date(NOW.getTime() - 3_600_000));
    const row = roomRow({ owner: roomJid(context, topic.roomLocalpart), nick: 'Other' });
    expect(await resolveCandidate(deps, userId, ownerFor(userId), row)).toEqual({
      status: 'ok',
      message: {
        chatJid: roomJid(context, topic.roomLocalpart),
        senderName: 'Other',
        place: 'Team › Backend',
        text: 'hello',
        messageId: 'origin-1',
      },
    });
  });
});
