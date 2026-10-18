import type { PGlite } from '@electric-sql/pglite';
import { Effect } from 'effect';

// The database key names the database only: production keeps the URL, the `effect/sql`
// runtime owns the pool, and tests hand over their raw PGlite handle.
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
    close: () => Effect.runPromise(Effect.void),
  };
}
