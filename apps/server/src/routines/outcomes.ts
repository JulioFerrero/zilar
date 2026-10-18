// The records one run writes, the fixed notices and the post helpers.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Payload } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { buildBlocksPayload } from '../message-blocks/build';
import { withoutMedia } from '../message-blocks/media-ids';
import { truncateChars } from '../text';
import { cardHeader } from '../tools/card-header';
import { describeSchedule } from '../tools/routine-adapters';
import { auditPaused, auditRun } from './audit';
import type { ExecuteRoutineOptions, ExecuteRoutinePorts } from './execute';
import { parseRoutineSchedule } from './schedule';

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
