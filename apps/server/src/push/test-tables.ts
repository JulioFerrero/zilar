import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';

// Creates the push tables on a test database without a migration file: the
// T-0119 migration lands later (schema ordering across parallel schema
// tasks), but the push tests still need the tables. The DDL mirrors
// the `push_subscriptions` and `push_settings` migration SQL in `apps/server/drizzle/`;
// the migration replaces this helper's effect in production.
export async function createPushTestTables(db: ServerDatabase): Promise<void> {
  const program = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
      node TEXT NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      CONSTRAINT push_subscriptions_node_length_check
        CHECK (char_length(node) BETWEEN 1 AND 256)
    )`;
    yield* sql`
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON push_subscriptions (user_id)`;
    yield* sql`
    CREATE TABLE IF NOT EXISTS push_settings (
      user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
      show_previews BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  });
  await sqlRuntimeFor(db).runPromise(program);
}
