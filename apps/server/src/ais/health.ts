// T-1504: the AI health read behind the picture's health dot. "Failing" is
// only known to the task log, so this module reads the latest logged turn
// `error` per AI that no `answer` has followed, from the last 7 days. It is
// best-effort decoration like `usage`: a failed read leaves every AI healthy
// (`lastFailure: null`) rather than failing the list.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

/** One AI's latest unanswered failure, as the wire carries it. */
export interface LastFailure {
  kind: string;
  at: string;
}

export type WithLastFailure<T> = T & { lastFailure: LastFailure | null };

// The window a failure stays interesting in; the retention sweeper deletes the
// log after 30 days, so 7 is a product choice, not a storage bound.
const FAILURE_WINDOW = '7 days';

// `data->>'kind'` is text or null (a row written before the field existed).
interface LastFailureRow {
  aiId: string;
  kind: string | null;
  at: Date;
}

// The latest unanswered `error` per AI, in one query for the whole list:
// `DISTINCT ON (ai_id)` keeps the newest error, and the `NOT EXISTS` drops an
// AI whose error an `answer` has cleared. With no ids it answers an empty map
// and runs no query.
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
    // A row without a kind cannot say why it failed, so it is left out.
    if (row.kind === null) {
      continue;
    }
    failures.set(row.aiId, { kind: row.kind, at: new Date(row.at).toISOString() });
  }
  return failures;
}

// The list decorator: one failure read for the whole list, so the list never
// runs a query per AI. Any failure of the read gives every AI `lastFailure:
// null`.
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
