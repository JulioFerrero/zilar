// T-1028: size split of `routines/execute.ts`. The records one run writes
// (skipped, ok, failure, pause), the fixed notices and the post helpers live
// here; the old path stays the barrel.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { truncateChars } from '../text';
import { auditPaused, auditRun } from './audit';
import type { ExecuteRoutineOptions, ExecuteRoutinePorts } from './execute';

export const MAX_POST_TEXT_CHARS = 4_000;
export const MAX_CONSECUTIVE_FAILURES = 3;

export const FAILURE_PAUSE_NOTICE = (title: string): string =>
  `The routine "${title}" was paused after 3 failed runs. Ask me to fix it.`;

export const HOSTS_CHANGED_NOTICE = (title: string): string =>
  `The routine "${title}" is paused: its tool now contacts new sites. Ask me to schedule it again to approve them.`;

export async function postResult(
  ports: ExecuteRoutinePorts,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  outputText: string,
): Promise<boolean> {
  const text = `${row.title}\n${truncateChars(outputText, MAX_POST_TEXT_CHARS)}`;
  try {
    return await ports.post({
      aiId: row.aiId,
      groupId: row.groupId,
      ...(row.topicId === null ? {} : { topicId: row.topicId }),
      text,
    });
  } catch {
    // A throwing post is a `skipped` like a `false` answer: the chat
    // layer is best-effort, and the failure counter is for tool runs.
    options.logger.warn({ routineId: row.id }, 'routine post threw');
    return false;
  }
}

export async function markSkipped(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_run_at = ${at}, last_status = 'skipped', updated_at = ${at}
        WHERE id = ${row.id}`;
    }),
  );
  await auditRun(options, row, 'skipped', startedAt);
}

export async function markOk(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_run_at = ${at}, last_status = 'ok', consecutive_failures = 0, updated_at = ${at}
        WHERE id = ${row.id}`;
    }),
  );
  await auditRun(options, row, 'ok', startedAt);
}

// One failure more. The 3rd consecutive failure also pauses the routine
// and posts the fixed notice once. A deleted tool (`deleted: true`, from
// the step-2/step-4 race) pauses immediately with the same notice.
export async function recordFailure(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await pauseForFailures(db, options, ports, row, at, startedAt, false);
}

export async function pauseForFailures(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  at: Date,
  startedAt: number,
  deleted: boolean,
): Promise<void> {
  const failures = deleted ? MAX_CONSECUTIVE_FAILURES : row.consecutiveFailures + 1;
  const pausing = failures >= MAX_CONSECUTIVE_FAILURES;
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (pausing) {
        yield* sql`UPDATE routines
          SET last_run_at = ${at}, last_status = 'error', consecutive_failures = ${failures}, status = 'paused', paused_reason = 'failures', updated_at = ${at}
          WHERE id = ${row.id}`;
      } else {
        yield* sql`UPDATE routines
          SET last_run_at = ${at}, last_status = 'error', consecutive_failures = ${failures}, updated_at = ${at}
          WHERE id = ${row.id}`;
      }
    }),
  );
  await auditRun(options, row, 'error', startedAt);
  if (pausing) {
    await auditPaused(options, row, 'failures');
    await postNotice(ports, options, row, FAILURE_PAUSE_NOTICE(row.title));
  }
}

export async function pauseForHostsChanged(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET status = 'needs_approval', paused_reason = 'hosts_changed', last_run_at = ${at}, last_status = 'skipped', updated_at = ${at}
        WHERE id = ${row.id}`;
    }),
  );
  await auditRun(options, row, 'skipped', startedAt);
  await auditPaused(options, row, 'hosts_changed');
  await postNotice(ports, options, row, HOSTS_CHANGED_NOTICE(row.title));
}

// Best-effort fixed notices: the chat layer may answer `false` (the AI
// left the room); the pause itself is already recorded either way.
async function postNotice(
  ports: ExecuteRoutinePorts,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  text: string,
): Promise<void> {
  try {
    await ports.post({
      aiId: row.aiId,
      groupId: row.groupId,
      ...(row.topicId === null ? {} : { topicId: row.topicId }),
      text,
    });
  } catch {
    options.logger.warn({ routineId: row.id }, 'routine notice post threw');
  }
}
