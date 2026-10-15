// T-1576: the `ask_people` runner stores an `ai_questions` row, posts the
// question card and stamps the card's id on the still-open row.
import type { Payload } from '@zilar/protocol';
import type { XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../../test-support';
import { seedAi, seedUser } from '../../test-support/seed';
import { createAskPeopleRunner } from './ask-people';
import type { AiSession, GatewayLogger } from './contracts';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };

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
    rooms: new Map([[room, { groupId: 'g-1', topicId: 'topic-1', joinedAtMs: 0, nick: 'Helper' }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

interface SentMessage {
  to: string;
  kind: string;
  text: string;
  payload?: Payload;
}

async function storedMessageId(
  context: TestContext,
  id: string,
): Promise<string | null | undefined> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ messageId: string | null }>`SELECT message_id FROM ai_questions
        WHERE id = ${id}`;
    }),
  );
  return row?.messageId;
}

async function openQuestionCount(context: TestContext, aiId: string): Promise<number> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ai_questions
        WHERE ai_id = ${aiId} AND status = 'open' AND expires_at > now()`;
    }),
  );
  return row?.total ?? 0;
}

describe('ask_people runner', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('posts the question payload and stamps the returned id', async () => {
    const ownerId = await seedUser(context);
    const { aiId, jid } = await seedAi(context, ownerId);
    const roomJid = 'askpeople@rooms.zilar.localhost';
    const session = sessionFor(aiId, jid, roomJid);
    const sent: SentMessage[] = [];
    const runner = createAskPeopleRunner(
      context.db,
      silentLogger,
      async (_session, to, kind, text, opts) => {
        sent.push({
          to,
          kind,
          text,
          ...(opts?.payload === undefined ? {} : { payload: opts.payload }),
        });
        return { id: 'card-1' };
      },
    );

    const result = await runner.runAskPeople(
      session,
      { question: 'Which ship date?', options: ['Friday', 'Monday'] },
      { groupId: 'g-1', topicId: 'topic-1', roomJid },
    );

    expect(result.content).toBe(
      'Your question was posted. The people here will answer in this room; wait for their reply.',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(roomJid);
    expect(sent[0]?.kind).toBe('groupchat');
    expect(sent[0]?.text).toBe('Which ship date?\n1. Friday\n2. Monday');
    const payload = sent[0]?.payload;
    expect(payload).toMatchObject({
      v: 0,
      type: 'question',
      data: { ai: jid, question: 'Which ship date?', options: ['Friday', 'Monday'] },
    });
    const questionId = payload?.type === 'question' ? payload.data.id : '';
    expect(await storedMessageId(context, questionId)).toBe('card-1');
  });

  it('expires the row so a failed send refunds the cap slot', async () => {
    const ownerId = await seedUser(context);
    const { aiId, jid } = await seedAi(context, ownerId);
    const roomJid = 'askpeople@rooms.zilar.localhost';
    const session = sessionFor(aiId, jid, roomJid);
    const runner = createAskPeopleRunner(context.db, silentLogger, async () => {
      throw new Error('xmpp down');
    });

    const result = await runner.runAskPeople(
      session,
      { question: 'Which ship date?', options: ['Friday', 'Monday'] },
      { groupId: 'g-1', topicId: 'topic-1', roomJid },
    );

    expect(result.content).toBe('error: the question could not be posted');
    // The row written before the failed send is no longer open, so it cannot
    // fill one of the AI's open-question slots although no card is visible.
    expect(await openQuestionCount(context, aiId)).toBe(0);
  });

  it('treats a dropped send as a failure and refunds the cap slot', async () => {
    const ownerId = await seedUser(context);
    const { aiId, jid } = await seedAi(context, ownerId);
    const roomJid = 'askpeople@rooms.zilar.localhost';
    const session = sessionFor(aiId, jid, roomJid);
    // An empty id is what `liveSendMessage` returns when the stop kill-switch
    // dropped the stanza: nothing was posted.
    const runner = createAskPeopleRunner(context.db, silentLogger, async () => ({ id: '' }));

    const result = await runner.runAskPeople(
      session,
      { question: 'Which ship date?', options: ['Friday', 'Monday'] },
      { groupId: 'g-1', topicId: 'topic-1', roomJid },
    );

    expect(result.content).toBe('error: the question could not be posted');
    expect(await openQuestionCount(context, aiId)).toBe(0);
  });
});
