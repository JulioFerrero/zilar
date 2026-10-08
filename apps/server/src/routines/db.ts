import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';

export function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}
