import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { HttpError } from '../errors';
import {
  answerQuestion,
  createQuestion,
  expireQuestion,
  findOpenQuestionByMessage,
  listOpenQuestions,
  MAX_OPEN_QUESTIONS_PER_AI,
  setQuestionMessageId,
} from './service';

async function questionStatus(context: TestContext, id: string): Promise<string | undefined> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ status: string }>`SELECT status FROM ai_questions WHERE id = ${id}`;
    }),
  );
  return row?.status;
}

describe('questions service', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAiId(): Promise<string> {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    return aiId;
  }

  it('creates a question and finds it by its message id', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      topicId: 'topic-1',
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Which ship date?',
      options: ['Friday', 'Monday'],
    });

    expect(row.status).toBe('open');
    expect(row.messageId).toBeNull();
    expect(row.options).toEqual(['Friday', 'Monday']);
    expect(row.expiresAt.getTime()).toBeGreaterThan(row.createdAt.getTime());

    const messageId = randomUUID();
    expect(await setQuestionMessageId(context.db, row.id, messageId)).toBe(true);
    expect(
      (await listOpenQuestions(context.db, { topicId: 'topic-1' })).map((item) => item.id),
    ).toEqual([row.id]);
    const found = await findOpenQuestionByMessage(context.db, messageId);
    expect(found?.id).toBe(row.id);
    expect(found?.question).toBe('Which ship date?');
  });

  it('answers once and a second answer changes nothing', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Ready?',
      options: ['Yes', 'No'],
    });

    expect(await answerQuestion(context.db, row.id, { answer: 'Yes', answeredBy: 'user-1' })).toBe(
      true,
    );
    expect(await answerQuestion(context.db, row.id, { answer: 'No', answeredBy: 'user-2' })).toBe(
      false,
    );
    expect(await questionStatus(context, row.id)).toBe('answered');
  });

  it('does not treat an expired question as open', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Still there?',
      options: ['Yes', 'No'],
      ttlMs: -1000,
    });
    const messageId = randomUUID();
    await setQuestionMessageId(context.db, row.id, messageId);

    expect(await findOpenQuestionByMessage(context.db, messageId)).toBeNull();
    expect(await answerQuestion(context.db, row.id, { answer: 'Yes', answeredBy: 'user-1' })).toBe(
      false,
    );
  });

  it('does not stamp a closed row', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Ship it?',
      options: ['Yes', 'No'],
    });
    // Answered before the card went out: the row is no longer open.
    expect(await answerQuestion(context.db, row.id, { answer: 'Yes', answeredBy: 'user-1' })).toBe(
      true,
    );

    expect(await setQuestionMessageId(context.db, row.id, randomUUID())).toBe(false);
    const [stored] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ messageId: string | null }>`SELECT message_id FROM ai_questions
          WHERE id = ${row.id}`;
      }),
    );
    expect(stored?.messageId).toBeNull();
  });

  it('expires an unposted open row so it stops counting against the cap', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Which ship date?',
      options: ['Friday', 'Monday'],
    });

    expect(await expireQuestion(context.db, row.id)).toBe(true);
    expect(await questionStatus(context, row.id)).toBe('expired');

    // A stamped row has a visible card and is left alone.
    const stamped = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'And this one?',
      options: ['Yes', 'No'],
    });
    await setQuestionMessageId(context.db, stamped.id, randomUUID());
    expect(await expireQuestion(context.db, stamped.id)).toBe(false);
    expect(await questionStatus(context, stamped.id)).toBe('open');
  });

  it('refuses a question with too few or too many options', async () => {
    const aiId = await seedAiId();
    const base = {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Pick one',
    };

    await expect(
      createQuestion(context.db, { ...base, options: ['Only one'] }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      createQuestion(context.db, { ...base, options: ['a', 'b', 'c', 'd', 'e'] }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      createQuestion(context.db, { ...base, options: ['a', 'x'.repeat(41)] }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('refuses a blank question or option', async () => {
    const aiId = await seedAiId();
    const base = {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Pick one',
      options: ['Yes', 'No'],
    };

    await expect(createQuestion(context.db, { ...base, question: '   ' })).rejects.toBeInstanceOf(
      HttpError,
    );
    await expect(
      createQuestion(context.db, { ...base, options: ['Yes', '   '] }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('refuses once the AI has too many open questions', async () => {
    const aiId = await seedAiId();
    for (let index = 0; index < MAX_OPEN_QUESTIONS_PER_AI; index += 1) {
      await createQuestion(context.db, {
        aiId,
        roomJid: 'room@rooms.zilar.localhost',
        question: `Question ${index}`,
        options: ['Yes', 'No'],
      });
    }

    await expect(
      createQuestion(context.db, {
        aiId,
        roomJid: 'room@rooms.zilar.localhost',
        question: 'One too many',
        options: ['Yes', 'No'],
      }),
    ).rejects.toMatchObject({ status: 429, code: 'too_many_questions' });
  });

  it('admits only one create when two race for the last open slot', async () => {
    const aiId = await seedAiId();
    for (let index = 0; index < MAX_OPEN_QUESTIONS_PER_AI - 1; index += 1) {
      await createQuestion(context.db, {
        aiId,
        roomJid: 'room@rooms.zilar.localhost',
        question: `Question ${index}`,
        options: ['Yes', 'No'],
      });
    }

    // One slot left. Both creates run at once: the per-AI advisory lock
    // serializes them, so exactly one wins and the loser answers 429 —
    // never two rows over the cap.
    const [first, second] = await Promise.all([
      createQuestion(context.db, {
        aiId,
        roomJid: 'room@rooms.zilar.localhost',
        question: 'Race A',
        options: ['Yes', 'No'],
      }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      createQuestion(context.db, {
        aiId,
        roomJid: 'room@rooms.zilar.localhost',
        question: 'Race B',
        options: ['Yes', 'No'],
      }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ]);
    expect([first, second].filter((outcome) => outcome.ok)).toHaveLength(1);
    const losers = [first, second].filter((outcome) => !outcome.ok);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    if (loser !== undefined && !loser.ok) {
      expect(loser.error).toMatchObject({ status: 429, code: 'too_many_questions' });
    }
    const [countRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ai_questions
          WHERE ai_id = ${aiId} AND status = 'open'`;
      }),
    );
    expect(countRow?.total).toBe(MAX_OPEN_QUESTIONS_PER_AI);
  });
});
