import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import * as schema from './schema';

type Schema = typeof schema;

export type PostgresServerDatabase = PostgresJsDatabase<Schema> & { $client: unknown };
export type PgliteServerDatabase = PgliteDatabase<Schema> & { $client: unknown };
export type ServerDatabase = PostgresServerDatabase | PgliteServerDatabase;

export interface DbClient {
  db: PostgresServerDatabase;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbClient {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });

  return {
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
