// T-0104: one routine run. The scheduler claims the row first (advancing
// `next_run_at`); this module runs the claimed row through the ordered
// checks and records the outcome. Stops at the first failing step:
//
// 1. The AI must be `active` and (for a topic routine) still a member of
//    the topic's room — otherwise `skipped`, post nothing, stay active.
// 2. The tool must exist (not deleted) — otherwise `paused`/`failures`
//    with the fixed 3-failure notice.
// 3. Host pinning: the tool's current version `hosts` must be a subset of
//    the routine's `approved_hosts` — otherwise `needs_approval` /
//    `hosts_changed` with the fixed hosts notice, audited `routine.paused`.
// 4. Run the current version through the injected `runTool` port
//    (`trigger: 'routine'`, the routine's `input`).
// 5. Success posts `"<title>\n<output.text>"` (trimmed to 4 000 chars)
//    through `post`; a `false` answer means the AI is stopped or not in
//    the room, so `skipped` with no failure count.
// 6. Failure increments `consecutive_failures`; the 3rd in a row pauses
//    with the fixed notice. Tool error text and logs never reach the chat
//    (they stay in `ai_tool_runs`).
//
// Every run audits `routine.run` with `detail { status, durationMs }`
// only — never output text, source, or an error message. Pauses also
// audit `routine.paused` with the reason.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { routines } from '../db/schema';
import type { TopicRow } from '../topics/access';
import { allowedTopicAiIds } from '../topics/access';
import { runToolVersion, ToolServiceError } from '../tools/service';
import type { ToolRunner } from '../tools/types';
import { runSql } from './db';

export const MAX_POST_TEXT_CHARS = 4_000;
export const MAX_CONSECUTIVE_FAILURES = 3;

export const FAILURE_PAUSE_NOTICE = (title: string): string =>
  `The routine "${title}" was paused after 3 failed runs. Ask me to fix it.`;

export const HOSTS_CHANGED_NOTICE = (title: string): string =>
  `The routine "${title}" is paused: its tool now contacts new sites. Ask me to schedule it again to approve them.`;

export type RoutineRow = typeof routines.$inferSelect;

interface AiStatusRow {
  status: string;
}

interface ToolRow {
  deletedAt: Date | null;
  currentVersion: number;
}

interface ToolVersionHostsRow {
  hosts: string[];
}

interface GroupAiRow {
  aiId: string;
}

type TopicRoomRow = Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>;

export interface ExecuteRoutinePorts {
  /** Runs one tool version (`runToolVersion` in production). */
  runTool: ToolRunner;
  /** Posts as the AI (`postToChat` in production). `false` = not posted. */
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
  }) => Promise<boolean>;
}

export interface RoutineRunLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ExecuteRoutineOptions {
  db: ServerDatabase;
  now?: () => Date;
  audit: AuditRecorder;
  logger: RoutineRunLogger;
}

export async function executeRoutine(
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  options: ExecuteRoutineOptions,
): Promise<void> {
  const db = options.db;
  const now = options.now ?? (() => new Date());
  const startedAt = Date.now();
  const at = now();

  // Step 1: the AI must be active and (for a topic routine) still a member
  // of the topic's room. A personal routine needs no room row: the `post`
  // answering `false` is the guard there.
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiStatusRow>`SELECT status FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai || ai.status !== 'active') {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  if (row.topicId !== null && !(await isAiInTopicRoom(db, row))) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }

  // Step 2: the tool must exist (not deleted).
  const [tool] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`SELECT deleted_at, current_version FROM ai_tools WHERE id = ${row.toolId} LIMIT 1`;
    }),
  );
  if (!tool || tool.deletedAt !== null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }

  // Step 3: host pinning against the current version. Fewer hosts (or a
  // code-only change) keep running; a new host pauses before any run.
  const currentHosts = await readCurrentHosts(db, row.toolId, tool.currentVersion);
  if (currentHosts === null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }
  if (!isSubset(currentHosts, row.approvedHosts)) {
    await pauseForHostsChanged(db, options, ports, row, at, startedAt);
    return;
  }

  // Step 4: run the current version with the routine's input.
  let outputText: string | null = null;
  try {
    const { result } = await runToolVersion(
      { db, runner: ports.runTool },
      { toolId: row.toolId, input: row.input ?? null, trigger: 'routine' },
      at,
    );
    if (!result.ok) {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    outputText = result.output.text;
  } catch (error) {
    // `runToolVersion` throws `ai_not_active` when the AI stopped between
    // the step-1 check and the run, and `not_found` when the tool was
    // deleted in between. Anything else is a run failure like `ok: false`
    // (a throwing runner still counts: the tool did not produce output).
    if (error instanceof ToolServiceError && error.errorCode === 'ai_not_active') {
      await markSkipped(db, options, row, at, startedAt);
      return;
    }
    if (error instanceof ToolServiceError && error.errorCode === 'not_found') {
      await pauseForFailures(db, options, ports, row, at, startedAt, true);
      return;
    }
    options.logger.warn({ routineId: row.id }, 'routine tool runner threw');
    await recordFailure(db, options, ports, row, at, startedAt);
    return;
  }

  // Step 5: post the output as the AI. `false` (or a throw) means the AI
  // is stopped or not in the room: `skipped` with no failure count.
  const posted = await postResult(ports, options, row, outputText);
  if (!posted) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  await markOk(db, options, row, at, startedAt);
}

// Whether the AI is still a member of the routine topic's room: General
// topics read `group_ais`; other topics use the derived rule of
// `allowedTopicAiIds` (the AI is in `topic_ais` and, in a private topic, its
// owner still sees the topic), so the tool never runs for an AI that may no
// longer be there. An archived topic's room is gone, so the routine skips.
async function isAiInTopicRoom(db: ServerDatabase, row: RoutineRow): Promise<boolean> {
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRoomRow>`SELECT id, group_id, visibility, is_general, archived_at
        FROM topics
        WHERE id = ${row.topicId as string}
        LIMIT 1`;
    }),
  );
  if (!topic || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    const [match] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupAiRow>`SELECT ai_id FROM group_ais
          WHERE group_id = ${row.groupId as string} AND ai_id = ${row.aiId}
          LIMIT 1`;
      }),
    );
    return match !== undefined;
  }
  return (await allowedTopicAiIds(db, topic)).has(row.aiId);
}

async function readCurrentHosts(
  db: ServerDatabase,
  toolId: string,
  currentVersion: number,
): Promise<string[] | null> {
  const [version] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolVersionHostsRow>`SELECT hosts FROM ai_tool_versions
        WHERE tool_id = ${toolId} AND version = ${currentVersion}
        LIMIT 1`;
    }),
  );
  return version ? [...version.hosts] : null;
}

function isSubset(current: readonly string[], approved: readonly string[]): boolean {
  const allowed = new Set(approved);
  return current.every((host) => allowed.has(host));
}

async function postResult(
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

function truncateChars(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

async function markSkipped(
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

async function markOk(
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
async function recordFailure(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await pauseForFailures(db, options, ports, row, at, startedAt, false);
}

async function pauseForFailures(
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

async function pauseForHostsChanged(
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

async function auditRun(
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  status: 'ok' | 'error' | 'skipped',
  startedAt: number,
): Promise<void> {
  // `detail` carries the status and the duration only: never output text,
  // source, or an error message.
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
