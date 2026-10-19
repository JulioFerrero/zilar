import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { type Payload } from '@zilar/protocol';
import { type ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { buildBlocksPayload } from '../message-blocks/build';
import { withoutMedia } from '../message-blocks/media-ids';
import { truncateChars } from '../text';
import { cardHeader } from '../tools/card-header';
import { describeSchedule } from '../tools/routine-adapters';
import { type ExecuteRoutineOptions, type ExecuteRoutinePorts } from './execute';
import { parseRoutineSchedule } from './schedule';
import { type RoutineRow } from '../db/rows-agents';
async function auditRun(
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  status: 'ok' | 'error' | 'skipped',
  startedAt: number,
): Promise<void> {
  // `detail` carries the status and duration only: never output text, source, or an error message.
  await options.audit.record({
    actorUserId: null,
    aiId: row.aiId,
    groupId: row.groupId,
    action: 'routine.run',
    subjectId: row.id,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: status === 'error' ? 'error' : 'ok',
    detail: { status, durationMs: Math.max(0, Date.now() - startedAt) },
  });
}

async function auditPaused(
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  reason: 'failures' | 'hosts_changed',
): Promise<void> {
  await options.audit.record({
    actorUserId: null,
    aiId: row.aiId,
    groupId: row.groupId,
    action: 'routine.paused',
    subjectId: row.id,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { reason },
  });
}

export const MAX_POST_TEXT_CHARS = 4_000;
export const MAX_CONSECUTIVE_FAILURES = 3;

function updateRoutine(
  db: ServerDatabase,
  write: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError.SqlError>,
): Promise<void> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* write(sql);
    }),
  );
}

export const FAILURE_PAUSE_NOTICE = (title: string): string =>
  `The routine "${title}" was paused after 3 failed runs. Ask me to fix it.`;

export const HOSTS_CHANGED_NOTICE = (title: string): string =>
  `The routine "${title}" is paused: its tool now contacts new sites. Ask me to schedule it again to approve them.`;

export async function postResult(
  ports: ExecuteRoutinePorts,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  outputText: string,
  outputBlocks: unknown,
  outputCard?: unknown,
): Promise<boolean> {
  const text = `${row.title}\n${truncateChars(outputText, MAX_POST_TEXT_CHARS)}`;
  const payload = routineBlocksPayload(row, outputText, outputBlocks, outputCard, options);
  try {
    return await ports.post({
      aiId: row.aiId,
      groupId: row.groupId,
      ...(row.topicId === null ? {} : { topicId: row.topicId }),
      text,
      ...(payload === undefined ? {} : { payload }),
    });
  } catch {
    // A throwing post is a `skipped` like a `false` answer; the failure counter is for tool runs.
    options.logger.warn({ routineId: row.id }, 'routine post threw');
    return false;
  }
}

// A saved tool's valid blocks ride on the post as a `blocks` payload with the routine title and schedule text; invalid blocks log only the routine id and fall back to plain text.
// The tool's `card.icon` is kept; media blocks are dropped because a routine cannot fetch media.
function routineBlocksPayload(
  row: RoutineRow,
  outputText: string,
  outputBlocks: unknown,
  outputCard: unknown,
  options: ExecuteRoutineOptions,
): Payload | undefined {
  if (outputBlocks === undefined) {
    return undefined;
  }
  const parsed = parseRoutineSchedule(row.schedule);
  const blocks = Array.isArray(outputBlocks) ? withoutMedia(outputBlocks) : outputBlocks;
  const built = buildBlocksPayload(
    {
      title: row.title,
      ...(parsed.ok ? { meta: describeSchedule(parsed.value) } : {}),
      icon: cardHeader(outputCard).icon,
      blocks,
    },
    outputText,
  );
  if (!built.ok) {
    options.logger.warn({ routineId: row.id }, 'routine blocks invalid');
    return undefined;
  }
  return built.payload;
}

export async function markSkipped(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await updateRoutine(
    db,
    (sql) => sql`UPDATE routines
    SET last_run_at = ${at}, last_status = 'skipped', updated_at = ${at}
    WHERE id = ${row.id}`,
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
  await updateRoutine(
    db,
    (sql) => sql`UPDATE routines
    SET last_run_at = ${at}, last_status = 'ok', consecutive_failures = 0, updated_at = ${at}
    WHERE id = ${row.id}`,
  );
  await auditRun(options, row, 'ok', startedAt);
}

// The 3rd consecutive failure pauses and posts the fixed notice once; a deleted tool pauses immediately.
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
  await updateRoutine(db, (sql) =>
    pausing
      ? sql`UPDATE routines
        SET last_run_at = ${at}, last_status = 'error', consecutive_failures = ${failures}, status = 'paused', paused_reason = 'failures', updated_at = ${at}
        WHERE id = ${row.id}`
      : sql`UPDATE routines
        SET last_run_at = ${at}, last_status = 'error', consecutive_failures = ${failures}, updated_at = ${at}
        WHERE id = ${row.id}`,
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
  await updateRoutine(
    db,
    (sql) => sql`UPDATE routines
    SET status = 'needs_approval', paused_reason = 'hosts_changed', last_run_at = ${at}, last_status = 'skipped', updated_at = ${at}
    WHERE id = ${row.id}`,
  );
  await auditRun(options, row, 'skipped', startedAt);
  await auditPaused(options, row, 'hosts_changed');
  await postNotice(ports, options, row, HOSTS_CHANGED_NOTICE(row.title));
}

// The chat layer may answer `false`; the pause is already recorded either way.
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
