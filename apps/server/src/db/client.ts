import type { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';

// The database key every module passes around. It names the database only:
// production keeps the URL, the `effect/sql` runtime (`effect/sql.ts`) owns the
// pool, and tests hand over their raw PGlite handle.
export interface PostgresServerDatabase {
  readonly kind: 'postgres';
  readonly url: string;
}

export type ServerDatabase = PostgresServerDatabase | PGlite;

export interface DbClient {
  db: PostgresServerDatabase;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbClient {
  return {
    db: { kind: 'postgres', url: databaseUrl },
    // The `effect/sql` runtime opens the pool and `disposeSqlRuntime(db)` closes
    // it, so there is nothing to end here.
    close: () => Effect.runPromise(Effect.void),
  };
}
