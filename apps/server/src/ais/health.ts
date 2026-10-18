// The latest logged turn `error` no `answer` has followed, from the last 7
// days. Best effort: a failed read leaves every AI healthy, not the list failed.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export interface LastFailure {
  kind: string;
  at: string;
}

export type WithLastFailure<T> = T & { lastFailure: LastFailure | null };

// A product choice: the log is kept 30 days, but 7 is what stays interesting.
const FAILURE_WINDOW = '7 days';

// `data->>'kind'` is text or null (a row written before the field existed).
interface LastFailureRow {
  aiId: string;
  kind: string | null;
  at: Date;
}

// `DISTINCT ON` keeps the newest error and `NOT EXISTS` drops one an answer has
// cleared. No ids means no query.
export async function lastFailures(
  db: ServerDatabase,
  aiIds: readonly string[],
): Promise<Map<string, LastFailure>> {
  if (aiIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<LastFailureRow>`SELECT DISTINCT ON (e.ai_id) e.ai_id, e.data->>'kind' AS kind, e.at
        FROM agent_task_events e
        WHERE e.ai_id IN ${sql.in(aiIds)} AND e.kind = ${'error'} AND e.at > now() - ${FAILURE_WINDOW}::interval
          AND NOT EXISTS (SELECT 1 FROM agent_task_events a
            WHERE a.ai_id = e.ai_id AND a.kind = ${'answer'} AND a.at > e.at)
        ORDER BY e.ai_id, e.at DESC`;
    }),
  );
  const failures = new Map<string, LastFailure>();
  for (const row of rows) {
    if (row.kind === null) {
      continue;
    }
    failures.set(row.aiId, { kind: row.kind, at: new Date(row.at).toISOString() });
  }
  return failures;
}

// One read for the whole list; any failure gives every AI `lastFailure: null`.
export async function withLastFailures<T extends { id: string }>(
  db: ServerDatabase,
  list: readonly T[],
): Promise<Array<WithLastFailure<T>>> {
  if (list.length === 0) {
    return [];
  }
  let failures: Map<string, LastFailure>;
  try {
    failures = await lastFailures(
      db,
      list.map((item) => item.id),
    );
  } catch {
    failures = new Map();
  }
  return list.map((item) => ({ ...item, lastFailure: failures.get(item.id) ?? null }));
}
