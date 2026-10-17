// T-0104: one routine run. The scheduler claims the row first (advancing
// `next_run_at`); this module runs the claimed row through the ordered
// checks and records the outcome. Stops at the first failing step:
//
// 1. The AI must be `active` and (for a topic routine) still a member of
//    the topic's room — otherwise `skipped`, post nothing, stay active.
//    Both kinds share this step; a prompt routine then takes its own path
//    (`executePromptRoutine`, T-1645) and skips step 2 onwards.
// 2. The tool must exist (not deleted) — otherwise `paused`/`failures`
//    with the fixed 3-failure notice.
// 3. Host pinning: the tool's current version `hosts` must be a subset of
//    the routine's `approved_hosts` — otherwise `needs_approval` /
//    `hosts_changed` with the fixed hosts notice, audited `routine.paused`.
// 4. Run the current version through the injected `runTool` port
//    (`trigger: 'routine'`, the routine's `input`).
// 5. Success posts `"<title>\n<output.text>"` (trimmed to 4 000 chars)
//    through `post`; a `false` answer means the AI is stopped or not in
//    the room, so `skipped` with no failure count. A routine linked to an
//    alert card posts only when `output.data.value` reaches
//    `input.threshold` (T-1878): below it the run is `ok` and silent, and
//    a missing number on either side is a failure. A linked run also rewrites
//    the card's note with the last check and value (T-1880); a failed refresh
//    never changes the outcome.
// 6. Failure increments `consecutive_failures`; the 3rd in a row pauses
//    with the fixed notice. Tool error text and logs never reach the chat
//    (they stay in `ai_tool_runs`).
//
// Every run audits `routine.run` with `detail { status, durationMs }`
// only — never output text, source, or an error message. Pauses also
// audit `routine.paused` with the reason.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Payload } from '@zilar/protocol';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { CorrectCardInput } from '../message-blocks/respond';
import { runToolVersion, ToolServiceError } from '../tools/service';
import type { ToolRunner } from '../tools/types';
import { refreshAlertNote } from './alert-note';
import { alertVerdict } from './alert-run';
import { executePromptRoutine, type PromptRunner } from './execute-prompt';
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
    payload?: Payload;
  }) => Promise<boolean>;
  /**
   * T-1645: runs one scheduled prompt turn (the AI gateway's scheduled turn),
   * for a `kind = 'prompt'` routine. Absent until a later task wires it; a
   * prompt routine is then recorded `skipped`.
   */
  runPrompt?: PromptRunner;
  /**
   * T-1880: corrects the linked alert card in the room after its note is
   * saved. Absent = no send (tests, no gateway).
   */
  correctCard?: (input: CorrectCardInput) => Promise<boolean>;
}

export interface RoutineRunLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ExecuteRoutineOptions {
  db: ServerDatabase;
  now?: () => Date;
  audit: AuditRecorder;
  logger: RoutineRunLogger;
  /** AI-18: how long to wait before the one post retry. Defaults to 30 s. */
  postRetryDelayMs?: number;
  /** Sleep seam for the post retry (tests pass a fake to run instantly). */
  sleep?: (ms: number) => Promise<void>;
}

// AI-18: a post during the AI's reconnect answers `false`; one retry after
// this wait catches the connection the next attempt.
export const POST_RETRY_DELAY_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeRoutine(
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  options: ExecuteRoutineOptions,
): Promise<void> {
  const db = options.db;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const postRetryDelayMs = options.postRetryDelayMs ?? POST_RETRY_DELAY_MS;
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

  // T-1645: a prompt routine needs no tool. Both kinds share the AI/room
  // preflight above; a prompt run then goes through its own path (daily cap,
  // the `runPrompt` port, `replied`/`failed`/`skipped`).
  if (row.kind === 'prompt') {
    await executePromptRoutine(ports, row, options, at, startedAt);
    return;
  }

  // Step 2: the tool must exist (not deleted).
  const toolId = row.toolId;
  if (toolId === null) {
    // A malformed tool row (a `kind = 'tool'` routine with no tool): fail
    // like a deleted tool.
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }
  const [tool] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`SELECT deleted_at, current_version FROM ai_tools WHERE id = ${toolId} LIMIT 1`;
    }),
  );
  if (!tool || tool.deletedAt !== null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }

  // Step 3: host pinning against the current version. Fewer hosts (or a
  // code-only change) keep running; a new host pauses before any run.
  const currentHosts = await readCurrentHosts(db, toolId, tool.currentVersion);
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
  let outputBlocks: unknown = undefined;
  let outputCard: unknown = undefined;
  let outputData: unknown = undefined;
  try {
    const { result } = await runToolVersion(
      { db, runner: ports.runTool },
      { toolId, input: row.input ?? null, trigger: 'routine' },
      at,
    );
    if (!result.ok) {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    outputText = result.output.text;
    outputBlocks = result.output.blocks;
    outputCard = result.output.card;
    outputData = result.output.data;
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

  // T-1878: a routine linked to an alert card reads the tool's numeric
  // `data.value` and compares it with the card's threshold. No number on
  // either side is a failure; below the threshold the run is `ok` and posts
  // nothing.
  if (row.alertCardId != null) {
    const verdict = alertVerdict(row.input, outputData);
    if (verdict.kind === 'error') {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    // T-1880: the card's note says when the routine last checked and what it
    // saw, whether the run posts or stays quiet. A failed refresh is logged
    // and swallowed, so it never changes the outcome below.
    await refreshAlertNote({
      db,
      ports,
      row,
      value: verdict.value,
      logger: options.logger,
    });
    if (verdict.kind === 'quiet') {
      await markOk(db, options, row, at, startedAt);
      return;
    }
  }

  // Step 5: post the output as the AI. `false` (or a throw) means the AI
  // is stopped or not in the room. AI-18: a post during the AI's reconnect
  // also answers `false`, so retry once after a short wait before giving up;
  // only then is the run `skipped` with no failure count.
  let posted = await postResult(ports, options, row, outputText, outputBlocks, outputCard);
  if (!posted) {
    await sleep(postRetryDelayMs);
    posted = await postResult(ports, options, row, outputText, outputBlocks, outputCard);
  }
  if (!posted) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  await markOk(db, options, row, at, startedAt);
}
