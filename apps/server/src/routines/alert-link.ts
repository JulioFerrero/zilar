// T-1856: the card↔routine link the alert card drives. A later task lets
// `post_blocks` name the routine; until then nothing sets the link, so this
// stays inert on live. One card block links to at most one live routine (the
// partial unique index backs it atomically).
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';

// The link for this card block already belongs to another live routine.
export class AlertLinkTaken extends Error {
  constructor() {
    super('That card block is already linked to a routine');
    this.name = 'AlertLinkTaken';
  }
}

// Points a routine at the alert card block that drives it. The unique index
// refuses a second live routine on the same block; that race answers
// `AlertLinkTaken` rather than a raw driver error.
export async function linkAlertCard(
  db: ServerDatabase,
  routineId: string,
  cardId: string,
  blockId: string,
): Promise<void> {
  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE routines
          SET alert_card_id = ${cardId}, alert_block_id = ${blockId}
          WHERE id = ${routineId} AND deleted_at IS NULL`;
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AlertLinkTaken();
    }
    throw error;
  }
}

// The live routine linked to one card block, or undefined when nothing (or
// only a deleted routine) is linked.
export async function findAlertRoutine(
  db: ServerDatabase,
  cardId: string,
  blockId: string,
): Promise<RoutineRow | undefined> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineRow>`SELECT * FROM routines
        WHERE alert_card_id = ${cardId} AND alert_block_id = ${blockId}
          AND deleted_at IS NULL
        LIMIT 1`;
      return found ?? null;
    }),
  );
  return row ?? undefined;
}

// Writes the threshold into the routine's free-form input, keeping every other
// key, and moves `updated_at`.
export async function setRoutineThreshold(
  db: ServerDatabase,
  id: string,
  threshold: number,
  now: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET input = jsonb_set(
              coalesce(input, '{}'::jsonb),
              '{threshold}',
              to_jsonb(${threshold}::double precision)
            ),
            updated_at = ${now.toISOString()}
        WHERE id = ${id} AND deleted_at IS NULL`;
    }),
  );
}
