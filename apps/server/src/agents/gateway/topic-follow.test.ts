// An AI assigned as a topic's follower answers plain human messages in that
// room only; an AI sender never queues a turn, and Stop pauses following until
// a human mention resumes it.
import { randomBytes, randomUUID } from 'node:crypto';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_XMPP_MUC_DOMAIN,
  createTestContext,
  expectedJid,
  testSql,
  type TestContext,
} from '../../test-support';
import { seedAi, seedGroup, seedUser } from '../../test-support/seed';
import { assertOwner } from '../../topics/members';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';
import { createGroupIngest } from './group-ingest';
import { waitFor } from '../../test-support/gateway-harness';
import { createStopTurn } from './stop';

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
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        owner_ai_id: ownerAiId,
        follower_ai_id: ownerAiId,
        is_general: false,
        created_by: createdBy,
      })}`;
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

describe('a topic owner follows its topic', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
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

    // Following is back: the next plain message queues too.
    ingest.handleRoomIncoming(
      session,
      message(room, expectedJid(human), 'm-3', 'plain after mention'),
    );
    await waitFor(() => turns.length === 2);
  });
});

// An AI owner must be one of the topic's AIs (`topic_ais`), so the owner
// follows the topic it owns.
describe('assertOwner', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

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
});
