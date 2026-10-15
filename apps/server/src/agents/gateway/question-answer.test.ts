// T-1579: a reply to a question card closes the question. The card's row is
// re-keyed from the gateway's origin id to the archive stanza id a client
// quotes in `replyTo`, and only the asking AI's session answers.
import { randomUUID } from 'node:crypto';
import type { Question } from '@zilar/protocol';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  TEST_XMPP_MUC_DOMAIN,
  createTestContext,
  expectedJid,
  testSql,
  type TestContext,
} from '../../test-support';
import { seedAi, seedUser } from '../../test-support/seed';
import {
  createQuestion,
  findOpenQuestionByMessage,
  setQuestionMessageId,
} from '../../questions/service';
import type { AiSession, GatewayLogger } from './contracts';
import { answerOnReply, rekeyOnReflection } from './question-answer';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };

function roomJid(): string {
  return `t${randomUUID().slice(0, 8)}@${TEST_XMPP_MUC_DOMAIN}`;
}

function sessionFor(aiId: string, aiJid: string, room: string, nick: string): AiSession {
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
    rooms: new Map([[room, { groupId: 'g', topicId: 't', joinedAtMs: 0, nick }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

// The AI's own card reflected back by the room: outgoing, carrying the question
// payload, `id` the stanza id and `originId` the id the gateway sent.
function reflection(
  room: string,
  fromJid: string,
  stanzaId: string,
  originId: string,
  question: Question,
): ChatMessage {
  return {
    id: stanzaId,
    originId,
    chatJid: room,
    kind: 'groupchat',
    fromJid,
    fromResolved: true,
    fromNick: 'Helper',
    body: question.question,
    payload: { v: 0, type: 'question', data: question },
    timestamp: new Date(),
    outgoing: true,
  };
}

function replyTo(room: string, fromJid: string, body: string, id: string): ChatMessage {
  return {
    id: `m-${randomUUID()}`,
    chatJid: room,
    kind: 'groupchat',
    fromJid,
    fromResolved: true,
    fromNick: 'Someone',
    body,
    replyTo: { id },
    timestamp: new Date(),
    outgoing: false,
  };
}

async function storedAnswer(
  context: TestContext,
  id: string,
): Promise<{ status: string; answer: string | null; answeredBy: string | null } | undefined> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ status: string; answer: string | null; answeredBy: string | null }>`
        SELECT status, answer, answered_by FROM ai_questions WHERE id = ${id}`;
    }),
  );
  return row;
}

describe('a reply closes the question (T-1579)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  interface Asked {
    aiId: string;
    aiJid: string;
    ownerId: string;
    room: string;
    questionId: string;
    questionText: string;
    options: string[];
    originId: string;
  }

  async function askQuestion(): Promise<Asked> {
    const ownerId = await seedUser(context);
    const { aiId, jid: aiJid } = await seedAi(context, ownerId);
    const room = roomJid();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: room,
      question: 'Which ship date?',
      options: ['Friday', 'Monday'],
    });
    const originId = randomUUID();
    await setQuestionMessageId(context.db, row.id, originId);
    return {
      aiId,
      aiJid,
      ownerId,
      room,
      questionId: row.id,
      questionText: row.question,
      options: row.options,
      originId,
    };
  }

  // The reflection arrives, then the row is re-keyed to the stanza id clients
  // quote; the asking AI's session is returned to answer the reply.
  async function rekey(asked: Asked): Promise<{ session: AiSession; stanzaId: string }> {
    const session = sessionFor(asked.aiId, asked.aiJid, asked.room, 'Helper');
    const stanzaId = randomUUID();
    const question: Question = {
      id: asked.questionId,
      ai: asked.aiJid,
      question: asked.questionText,
      options: asked.options,
    };
    await rekeyOnReflection(
      context.db,
      session,
      reflection(asked.room, `${asked.room}/Helper`, stanzaId, asked.originId, question),
      silentLogger,
    );
    return { session, stanzaId };
  }

  it('re-keys the card and closes the question with the option text', async () => {
    const asked = await askQuestion();
    const { session, stanzaId } = await rekey(asked);

    expect(await findOpenQuestionByMessage(context.db, asked.originId)).toBeNull();
    expect((await findOpenQuestionByMessage(context.db, stanzaId))?.id).toBe(asked.questionId);

    await answerOnReply(
      context.db,
      session,
      replyTo(asked.room, expectedJid(asked.ownerId), '@Helper Friday', stanzaId),
      silentLogger,
    );

    expect(await findOpenQuestionByMessage(context.db, stanzaId)).toBeNull();
    expect(await storedAnswer(context, asked.questionId)).toMatchObject({
      status: 'answered',
      answer: 'Friday',
      answeredBy: expectedJid(asked.ownerId),
    });
  });

  it('does nothing for a session that is not the asking AI', async () => {
    const asked = await askQuestion();
    const { stanzaId } = await rekey(asked);
    const otherOwner = await seedUser(context);
    const { aiId: otherAiId, jid: otherJid } = await seedAi(context, otherOwner);
    const otherSession = sessionFor(otherAiId, otherJid, asked.room, 'Other');

    await answerOnReply(
      context.db,
      otherSession,
      replyTo(asked.room, expectedJid(asked.ownerId), 'Monday', stanzaId),
      silentLogger,
    );

    expect((await findOpenQuestionByMessage(context.db, stanzaId))?.id).toBe(asked.questionId);
    expect(await storedAnswer(context, asked.questionId)).toMatchObject({ status: 'open' });
  });

  it('ignores a reply from an AI sender', async () => {
    const asked = await askQuestion();
    const { session, stanzaId } = await rekey(asked);

    await answerOnReply(
      context.db,
      session,
      replyTo(asked.room, asked.aiJid, '@Helper Friday', stanzaId),
      silentLogger,
    );

    expect((await findOpenQuestionByMessage(context.db, stanzaId))?.id).toBe(asked.questionId);
    expect(await storedAnswer(context, asked.questionId)).toMatchObject({ status: 'open' });
  });
});
