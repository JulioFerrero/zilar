import { Effect } from 'effect';
import { migrateSql, sqlRuntimeFor } from '../effect/sql';
import type { ServerDatabase } from './client';

// Applies the committed migrations on the effect/sql runtime; every caller registers
// that runtime first.
export async function runMigrations(db: ServerDatabase): Promise<void> {
  await sqlRuntimeFor(db).runPromise(
    migrateSql().pipe(
      Effect.tap((migrated) =>
        migrated.length === 0
          ? Effect.void
          : Effect.logInfo(`database migrations applied: ${migrated.map(([id]) => id).join(', ')}`),
      ),
    ),
  );
}
