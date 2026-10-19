import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { HttpError } from '../errors';
import {
  createQuestion,
  findOpenQuestionByMessage,
  MAX_OPEN_QUESTIONS_PER_AI,
  setQuestionMessageId,
} from './service';

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

  it('does not find a question through another room', async () => {
    const aiId = await seedAiId();
    const row = await createQuestion(context.db, {
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      question: 'Which ship date?',
      options: ['Friday', 'Monday'],
    });
    const messageId = randomUUID();
    await setQuestionMessageId(context.db, row.id, messageId);

    expect(
      await findOpenQuestionByMessage(context.db, messageId, 'other@rooms.zilar.localhost'),
    ).toBeNull();
    expect(
      (await findOpenQuestionByMessage(context.db, messageId, 'room@rooms.zilar.localhost'))?.id,
    ).toBe(row.id);
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
