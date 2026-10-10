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
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { runToolVersion, ToolServiceError } from '../tools/service';
import type { ToolRunner } from '../tools/types';
import {
  markOk,
  markSkipped,
  pauseForFailures,
  pauseForHostsChanged,
  postResult,
  recordFailure,
} from './outcomes';
import { isAiInTopicRoom, isSubset, readCurrentHosts } from './preflight';

// T-1028: size split of this file. The records a run writes live in
// `./outcomes`, the preflight checks in `./preflight` and the audit entries in
// `./audit`; this path stays the barrel so importers do not change.
export {
  FAILURE_PAUSE_NOTICE,
  HOSTS_CHANGED_NOTICE,
  MAX_CONSECUTIVE_FAILURES,
  MAX_POST_TEXT_CHARS,
} from './outcomes';
export type { RoutineRow };

interface AiStatusRow {
  status: string;
}

interface ToolRow {
  deletedAt: Date | null;
  currentVersion: number;
}

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
