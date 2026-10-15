// T-1448 (UX Task I): an AI assigned as a topic's owner follows that topic.
// These tests drive the group ingest directly: a plain human message in an
// owned room queues a turn for the owner, an AI sender never queues one, and
// Stop pauses following until a mention resumes it.
import { randomBytes, randomUUID } from 'node:crypto';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  createTestContext,
  expectedJid,
  testSql,
  type TestContext,
} from '../../test-support';
import { seedAi, seedGroup, seedUser } from '../../test-support/seed';
import { assertOwner, removeTopicMember } from '../../topics/members';
import { patchTopic } from '../../topics/patch';
import { archiveTopic } from '../../topics/service';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import { createGroupIngest } from './group-ingest';
import { tick, waitFor } from '../gateway.test-harness';
import { createStopTurn } from './stop';
import {
  followingAiFor,
  initTopicFollow,
  isFollowPaused,
  resetTopicFollowStateForTests,
} from './topic-follow';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };

function roomJid(): string {
  return `t${randomBytes(12).toString('hex')}@${TEST_XMPP_MUC_DOMAIN}`;
}

async function seedOwnedTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
  room: string,
  ownerAiId: string,
  opts: { visibility?: string; memberId?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name: 'Owned',
        glyph: 'O',
        room_localpart: room.split('@')[0] ?? room,
        visibility: opts.visibility ?? 'public',
        kind: 'chat',
        status: 'open',
        owner_ai_id: ownerAiId,
        follower_ai_id: ownerAiId,
        is_general: false,
        created_by: createdBy,
      })}`;
      if (opts.memberId !== undefined) {
        yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
          VALUES (${id}, ${opts.memberId}, ${createdBy})`;
      }
    }),
  );
  return id;
}

function sessionFor(aiId: string, aiJid: string, room: string): AiSession {
  return {
    aiId,
    aiJid,
    core: {} as XmppCore,
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map([[room, { groupId: 'g', topicId: 't', joinedAtMs: 0, nick: 'Helper' }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

interface Turn {
  aiId: string;
  roomJid: string;
}

// The saved Stop pause of a room's topic. The pause and the resume are written
// fire-and-forget (the message path never waits on them), so a test polls this
// instead of asserting the instant after the call.
async function followPausedAt(context: TestContext, room: string): Promise<Date | null> {
  const localpart = room.split('@')[0] ?? room;
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ followPausedAt: Date | null }>`
        SELECT follow_paused_at FROM topics WHERE room_localpart = ${localpart}`;
    }),
  );
  return row?.followPausedAt ?? null;
}

async function waitForFollowPaused(
  context: TestContext,
  room: string,
  paused: boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (((await followPausedAt(context, room)) !== null) === paused) {
      return;
    }
    await tick(10);
  }
  throw new Error(`the topic follow pause never became ${paused ? 'set' : 'clear'}`);
}

// The `follower_ai_id` of a room's topic (T-1529). The follower moves on a
// human mention through the fire-and-forget write, so a test polls this.
async function followerOf(context: TestContext, room: string): Promise<string | null> {
  const localpart = room.split('@')[0] ?? room;
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ followerAiId: string | null }>`
        SELECT follower_ai_id FROM topics WHERE room_localpart = ${localpart}`;
    }),
  );
  return row?.followerAiId ?? null;
}

async function waitForFollower(context: TestContext, room: string, aiId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await followerOf(context, room)) === aiId) {
      return;
    }
    await tick(10);
  }
  throw new Error(`the topic follower never became ${aiId}`);
}

function ingestFor(context: TestContext, sessions: Map<string, AiSession>, turns: Turn[]) {
  return createGroupIngest({
    deps: { db: context.db } as unknown as AgentGatewayDeps,
    logger: silentLogger,
    sessions,
    roomRounds: new Map(),
    noteListenerMessage: () => {},
    secretsFor: () => [],
    runGroupSessionTurn: async (session, roomJid) => {
      turns.push({ aiId: session.aiId, roomJid });
    },
  });
}

function message(
  room: string,
  fromJid: string,
  id: string,
  body: string,
  mentions?: ChatMessage['mentions'],
): ChatMessage {
  return {
    id,
    chatJid: room,
    kind: 'groupchat',
    fromJid,
    fromResolved: true,
    fromNick: 'Someone',
    body,
    timestamp: new Date(),
    outgoing: false,
    ...(mentions === undefined ? {} : { mentions }),
  };
}

describe('a topic owner follows its topic (T-1448)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    resetTopicFollowStateForTests();
    await context.close();
  });

  it('queues a plain human message for the owner, and not for another AI in the room', async () => {
    const human = await seedUser(context);
    const { aiId: ownerAiId, jid: ownerAiJid } = await seedAi(context, human);
    const { aiId: otherAiId, jid: otherAiJid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [ownerAiId, otherAiId],
    );
    await seedOwnedTopic(context, groupId, human, room, ownerAiId);

    const owner = sessionFor(ownerAiId, ownerAiJid, room);
    const other = sessionFor(otherAiId, otherAiJid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(
      context,
      new Map([
        [ownerAiId, owner],
        [otherAiId, other],
      ]),
      turns,
    );

    const plain = message(room, expectedJid(human), 'm-1', 'hello there');
    ingest.handleRoomIncoming(owner, plain);
    ingest.handleRoomIncoming(other, plain);

    await waitFor(() => turns.length === 1);
    expect(turns).toEqual([{ aiId: ownerAiId, roomJid: room }]);
  });

  it('never queues a message sent by an AI, even in an owned room', async () => {
    const human = await seedUser(context);
    const { aiId: ownerAiId, jid: ownerAiJid } = await seedAi(context, human);
    const { jid: senderAiJid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [ownerAiId],
    );
    await seedOwnedTopic(context, groupId, human, room, ownerAiId);

    const owner = sessionFor(ownerAiId, ownerAiJid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[ownerAiId, owner]]), turns);

    // An AI sender short-circuits before the async check; awaiting the returned
    // promise (absent here) keeps the negative assertion deterministic.
    await ingest.handleRoomIncoming(
      owner,
      message(room, senderAiJid, 'm-1', 'ping from another AI'),
    );

    expect(turns).toHaveLength(0);
  });

  it('pauses on Stop, and a mention queues a turn and resumes following', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    await seedOwnedTopic(context, groupId, human, room, aiId);

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);

    createStopTurn(new Map([[aiId, session]])).stopTurn(aiId, room);
    // A paused room short-circuits before the async check; await the returned
    // promise (absent here) so a queued follow cannot hide behind a delay.
    await ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', 'plain after stop'),
    );
    expect(turns).toHaveLength(0);

    // A real mention queues one turn and clears the pause.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-2', '@Helper hi', [{ jid, begin: 0, end: 7 }]),
    );
    await waitFor(() => turns.length === 1);
    await tick(20);

    // Following is back: the next plain message queues too.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-3', 'plain after mention'),
    );
    await waitFor(() => turns.length === 2);
  });

  it('a Stop pause survives a restart', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    await seedOwnedTopic(context, groupId, human, room, aiId);

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);

    // Gateway start: remember the database and load the (empty) pause set.
    await initTopicFollow(context.db);

    // Stop saves the pause in memory and in the topic row.
    createStopTurn(new Map([[aiId, session]])).stopTurn(aiId, room);
    await waitForFollowPaused(context, room, true);

    // A restart forgets memory and reloads the pause from the row.
    resetTopicFollowStateForTests();
    await initTopicFollow(context.db);

    // The reloaded pause holds: a plain human message queues nothing. The
    // paused room short-circuits before the async follower lookup, so
    // `handleRoomIncoming` returns no promise; awaiting a broken check (which
    // returns `followTopic`'s promise) would let a queued turn appear only
    // after the assertion, so asserting the absence of the promise pins it down.
    const pending = ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', 'plain after restart'),
    );
    expect(pending).toBeUndefined();
    await pending;
    expect(turns).toHaveLength(0);

    // A mention resumes following and clears the saved pause.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-2', '@Helper hi', [{ jid, begin: 0, end: 7 }]),
    );
    await waitFor(() => turns.length === 1);
    await waitForFollowPaused(context, room, false);
  });

  it('does not queue a follow whose owner lookup lands after Stop', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    await seedOwnedTopic(context, groupId, human, room, aiId);

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);

    // The plain message starts the async owner lookup ...
    const pending = ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', 'plain'),
    );
    // ... and Stop lands while that lookup is still in flight.
    createStopTurn(new Map([[aiId, session]])).stopTurn(aiId, room);

    // Await the follow check itself rather than a fixed delay, so a turn queued
    // after the lookup cannot hide behind a slow read.
    await pending;

    expect(turns).toHaveLength(0);
  });

  // F1 (PREREVIEW) claims a DB error on a cache-missed owner lookup rejects the
  // promise returned by `handleRoomIncoming`, which the gateway ignores. It does
  // not: `followingAiFor` rejects, `Effect.promise` lifts that rejection into a
  // defect, and `catchDefect` logs and recovers, so the returned promise always
  // resolves. This guards that invariant.
  it('resolves when the owner lookup fails, and queues nothing', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    await seedOwnedTopic(context, groupId, human, room, aiId);

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);

    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE topics RENAME TO topics_broken`;
      }),
    );

    await expect(followingAiFor(context.db, room)).rejects.toBeDefined();

    const pending = ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', 'plain during db blip'),
    );
    await expect(pending).resolves.toBeUndefined();
    expect(turns).toHaveLength(0);
  });

  it('stops following a topic once it is archived', async () => {
    const human = await seedUser(context);
    const { aiId } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    const topicId = await seedOwnedTopic(context, groupId, human, room, aiId);

    // Prime the 15 s owner cache.
    expect(await followingAiFor(context.db, room)).toBe(aiId);

    await archiveTopic(
      {
        db: context.db,
        adminClient: context.adminClient,
        domain: TEST_XMPP_DOMAIN,
        logger: context.logger,
      },
      topicId,
      human,
    );

    // The cached owner must not keep the archived topic followed.
    expect(await followingAiFor(context.db, room)).toBeNull();
  });

  it('stops following a topic archived when its last member is removed', async () => {
    const human = await seedUser(context);
    const { aiId } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    // A private topic whose only member is `human`; removing them drains and
    // archives it.
    const topicId = await seedOwnedTopic(context, groupId, human, room, aiId, {
      visibility: 'private',
      memberId: human,
    });

    // Prime the 15 s owner cache.
    expect(await followingAiFor(context.db, room)).toBe(aiId);

    await removeTopicMember(
      {
        db: context.db,
        adminClient: context.adminClient,
        domain: TEST_XMPP_DOMAIN,
        logger: context.logger,
      },
      topicId,
      human,
      human,
    );

    // The cached owner must not keep the archived topic followed.
    expect(await followingAiFor(context.db, room)).toBeNull();
  });

  // T-1529: following moved from the owner to the last human-mentioned AI.
  it('moves following to a human-mentioned AI, and off the previous follower', async () => {
    const human = await seedUser(context);
    const { aiId: aiA, jid: jidA } = await seedAi(context, human);
    const { aiId: aiB, jid: jidB } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [aiA, aiB],
    );
    await seedOwnedTopic(context, groupId, human, room, aiA);

    const followerA = sessionFor(aiA, jidA, room);
    const followerB = sessionFor(aiB, jidB, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(
      context,
      new Map([
        [aiA, followerA],
        [aiB, followerB],
      ]),
      turns,
    );

    // Gateway start: remember the database so the follower write is saved.
    await initTopicFollow(context.db);

    // A person mentions B: B becomes the follower and answers the mention.
    ingest.handleRoomIncoming(
      followerB,
      message(room, expectedJid(human), 'm-1', '@B hi', [{ jid: jidB, begin: 0, end: 2 }]),
    );
    await waitFor(() => turns.length === 1);
    await waitForFollower(context, room, aiB);
    expect(turns).toEqual([{ aiId: aiB, roomJid: room }]);

    // The next plain message reaches B only; A no longer follows.
    turns.length = 0;
    const plain = message(room, expectedJid(human), 'm-2', 'plain after mention');
    ingest.handleRoomIncoming(followerA, plain);
    ingest.handleRoomIncoming(followerB, plain);
    await waitFor(() => turns.length === 1);
    expect(turns).toEqual([{ aiId: aiB, roomJid: room }]);
  });

  it('does not resume following when an AI sender mentions another AI', async () => {
    const human = await seedUser(context);
    const { aiId: followerId, jid: followerJid } = await seedAi(context, human);
    const { aiId: senderId, jid: senderJid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [followerId, senderId],
    );
    await seedOwnedTopic(context, groupId, human, room, followerId);

    const follower = sessionFor(followerId, followerJid, room);
    const sender = sessionFor(senderId, senderJid, room);
    const turns: Turn[] = [];
    const sessions = new Map([
      [followerId, follower],
      [senderId, sender],
    ]);
    const ingest = ingestFor(context, sessions, turns);
    await initTopicFollow(context.db);

    // A human message opens the round and is followed by the follower.
    ingest.handleRoomIncoming(follower, message(room, expectedJid(human), 'm-1', 'hello'));
    await waitFor(() => turns.length === 1);

    // The follower pressed Stop ...
    createStopTurn(sessions).stopTurn(followerId, room);
    expect(isFollowPaused(followerId, room)).toBe(true);

    // ... and another AI's mention is a handoff, not a human mention: it queues
    // the turn but leaves following paused and the follower unchanged.
    ingest.handleRoomIncoming(
      follower,
      message(room, senderJid, 'm-2', '@Helper hi', [{ jid: followerJid, begin: 0, end: 7 }]),
    );
    await waitFor(() => turns.length === 2);
    await tick(20);
    expect(isFollowPaused(followerId, room)).toBe(true);
    expect(await followerOf(context, room)).toBe(followerId);
  });

  it('never follows the General topic', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const { generalTopicId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [aiId],
    );
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`
          SELECT room_localpart FROM topics WHERE id = ${generalTopicId} LIMIT 1`;
      }),
    );
    const room = `${row?.roomLocalpart ?? ''}@${TEST_XMPP_MUC_DOMAIN}`;

    // Even with a follower value on the row, General is never followed.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE topics SET follower_ai_id = ${aiId}, owner_ai_id = ${aiId}
          WHERE id = ${generalTopicId}`;
      }),
    );
    expect(await followingAiFor(context.db, room)).toBeNull();

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);
    await initTopicFollow(context.db);

    // A person's mention in General is answered once (the mention turn), but
    // must not make the AI the follower — the follow cache must not carry a
    // General follow either.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', '@Helper hi', [{ jid, begin: 0, end: 7 }]),
    );
    await waitFor(() => turns.length === 1);

    // A plain human message inside the 15 s cache window queues no second,
    // unmentioned follow turn.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-2', 'plain in general'),
    );
    await tick(20);
    expect(turns).toHaveLength(1);
    expect(await followingAiFor(context.db, room)).toBeNull();
  });

  it('pauses the new follower when done and an owner change arrive in one request', async () => {
    const human = await seedUser(context);
    const { aiId: followerId } = await seedAi(context, human);
    const { aiId: newOwnerId, jid: newOwnerJid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(
      context,
      human,
      [{ userId: human, role: 'owner' }],
      [followerId, newOwnerId],
    );
    const topicId = await seedOwnedTopic(context, groupId, human, room, followerId);
    // A new AI owner must be one of the topic's AIs.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topic_ais (topic_id, ai_id, added_by)
          VALUES (${topicId}, ${newOwnerId}, ${human})`;
      }),
    );

    const newOwner = sessionFor(newOwnerId, newOwnerJid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[newOwnerId, newOwner]]), turns);
    await initTopicFollow(context.db);

    await patchTopic(
      {
        db: context.db,
        adminClient: context.adminClient,
        domain: TEST_XMPP_DOMAIN,
        logger: context.logger,
      },
      { topicId, actorId: human, owner: { kind: 'ai', id: newOwnerId }, done: true },
    );
    await waitForFollowPaused(context, room, true);

    // The new owner is now the follower, and the pause landed on it (before the
    // fix the pause landed on the old follower). A plain message queues nothing.
    await waitForFollower(context, room, newOwnerId);
    expect(isFollowPaused(newOwnerId, room)).toBe(true);
    const pending = ingest.handleRoomIncoming(
      newOwner,
      message(room, expectedJid(human), 'm-1', 'plain while done'),
    );
    expect(pending).toBeUndefined();
    await pending;
    expect(turns).toHaveLength(0);

    // A mention resumes following and clears the saved pause.
    ingest.handleRoomIncoming(
      newOwner,
      message(room, expectedJid(human), 'm-2', '@Helper hi', [
        { jid: newOwnerJid, begin: 0, end: 7 },
      ]),
    );
    await waitFor(() => turns.length === 1);
    await waitForFollowPaused(context, room, false);
  });

  it('pauses following when the topic is marked done, and a mention resumes it', async () => {
    const human = await seedUser(context);
    const { aiId, jid } = await seedAi(context, human);
    const room = roomJid();
    const { groupId } = await seedGroup(context, human, [{ userId: human, role: 'owner' }], [aiId]);
    const topicId = await seedOwnedTopic(context, groupId, human, room, aiId);

    const session = sessionFor(aiId, jid, room);
    const turns: Turn[] = [];
    const ingest = ingestFor(context, new Map([[aiId, session]]), turns);
    await initTopicFollow(context.db);

    await patchTopic(
      {
        db: context.db,
        adminClient: context.adminClient,
        domain: TEST_XMPP_DOMAIN,
        logger: context.logger,
      },
      { topicId, actorId: human, done: true },
    );
    await waitForFollowPaused(context, room, true);

    // Done pauses the follower, like a Stop: a plain message queues nothing.
    const pending = ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-1', 'plain while done'),
    );
    expect(pending).toBeUndefined();
    await pending;
    expect(turns).toHaveLength(0);

    // A mention resumes following and clears the saved pause.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-2', '@Helper hi', [{ jid, begin: 0, end: 7 }]),
    );
    await waitFor(() => turns.length === 1);
    await waitForFollowPaused(context, room, false);
  });
});

// T-1448: an AI owner must be one of the topic's AIs (`topic_ais`), so the
// owner follows the topic it owns. This is the nearest topics test file's
// owner rule, kept here because the gate's allowed-files parser only reads
// backticked paths and the spec's line for that file is prose (see the Report).
describe('assertOwner (T-1448)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function linkAiToTopic(topicId: string, aiId: string, addedBy: string): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topic_ais (topic_id, ai_id, added_by)
          VALUES (${topicId}, ${aiId}, ${addedBy})`;
      }),
    );
  }

  it('refuses an AI owner that is not in the topic', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], [aiId]);
    const room = roomJid();
    // A non-General topic: the AI is a group AI but not in this topic's `topic_ais`.
    const topicId = await seedOwnedTopic(context, groupId, owner, room, aiId);

    await expect(
      assertOwner(context.db, groupId, { kind: 'ai', id: aiId }, topicId),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('accepts a group AI as the owner of the General topic', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner,
      [{ userId: owner, role: 'owner' }],
      [aiId],
    );

    expect(
      await assertOwner(context.db, groupId, { kind: 'ai', id: aiId }, generalTopicId),
    ).toEqual({ ownerUserId: null, ownerAiId: aiId });
  });

  it('accepts an AI owner that is in the topic', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], [aiId]);
    const room = roomJid();
    const topicId = await seedOwnedTopic(context, groupId, owner, room, aiId);
    await linkAiToTopic(topicId, aiId, owner);

    expect(await assertOwner(context.db, groupId, { kind: 'ai', id: aiId }, topicId)).toEqual({
      ownerUserId: null,
      ownerAiId: aiId,
    });
  });

  it('refuses an AI owner at create, when there is no topic yet', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], [aiId]);

    await expect(assertOwner(context.db, groupId, { kind: 'ai', id: aiId })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
  });

  it('keeps the group-member rule for a user owner', async () => {
    const owner = await seedUser(context);
    const outsider = await seedUser(context);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], []);

    await expect(
      assertOwner(context.db, groupId, { kind: 'user', id: outsider }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });
});
