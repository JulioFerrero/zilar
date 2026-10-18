import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { RoutineRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createPromptRoutine } from '../tools/routine-adapters';

// T-1870: the alert card block that drives a routine is written in the same
// INSERT that creates it, and one live block never creates a second routine.
describe('alert link on routine create', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  const now = new Date('2026-10-17T12:00:00.000Z');

  async function readRoutine(id: string): Promise<RoutineRow> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
      }),
    );
    const row = rows[0];
    if (!row) {
      throw new Error('routine row missing');
    }
    return row;
  }

  async function countLinked(cardId: string, blockId: string): Promise<number> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total
          FROM routines
          WHERE alert_card_id = ${cardId} AND alert_block_id = ${blockId}
            AND deleted_at IS NULL`;
      }),
    );
    return Number(rows[0]?.total ?? 0);
  }

  it('writes both link columns and refuses a second routine for the same block', async () => {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const { aiId } = await seedAi(context, ownerId);
    const createRoutine = (title: string, alertCard?: { cardId: string; blockId: string }) =>
      createPromptRoutine(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          title,
          schedule: { kind: 'interval', everyMinutes: 60 },
          prompt: 'Tell me when spending passes the threshold',
          userId: ownerId,
          ...(alertCard === undefined ? {} : { alertCard }),
        },
        now,
      );

    const plain = await createRoutine('Plain routine');
    expect(await readRoutine(plain.id)).toMatchObject({
      alertCardId: null,
      alertBlockId: null,
    });

    const linked = await createRoutine('Spend alert', {
      cardId: 'alert-origin',
      blockId: 'alert-1',
    });
    expect(await readRoutine(linked.id)).toMatchObject({
      alertCardId: 'alert-origin',
      alertBlockId: 'alert-1',
    });

    await expect(
      createRoutine('Second spend alert', { cardId: 'alert-origin', blockId: 'alert-1' }),
    ).rejects.toMatchObject({ errorCode: 'alert_card_taken' });
    expect(await countLinked('alert-origin', 'alert-1')).toBe(1);
  });
});
