// One routine run through the ordered checks, stopping at the first failing step:
// 1. AI `active` and (topic routine) still in the room, else `skipped`; a prompt routine takes its own path.
// 2. Tool exists, else `paused`/`failures` with the fixed 3-failure notice.
// 3. Host pinning: current version hosts must be a subset of `approved_hosts`, else `needs_approval`/`hosts_changed`.
// 4-5. Run the tool; a linked alert card posts only when the value reaches the threshold and rewrites the note.
// Every run audits `routine.run` with `{ status, durationMs }` only — never output text, source or an error.
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
  runTool: ToolRunner;
  // Posts as the AI; `false` = not posted.
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  // The gateway's scheduled prompt turn; absent means the run is recorded `skipped`.
  runPrompt?: PromptRunner;
  // Corrects the linked alert card in the room; absent = no send.
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
  // How long to wait before the one post retry. Defaults to 30 s.
  postRetryDelayMs?: number;
  // Sleep seam for the post retry (tests pass a fake).
  sleep?: (ms: number) => Promise<void>;
}

// A post during the AI's reconnect answers `false`; one retry after this wait catches the next connection.
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

  // Step 1: the AI must be active and, for a topic routine, still in the room; a personal routine relies on `post` answering `false`.
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

  // A prompt routine needs no tool; it shares the AI/room preflight and then takes its own path.
  if (row.kind === 'prompt') {
    await executePromptRoutine(ports, row, options, at, startedAt);
    return;
  }

  // Step 2: the tool must exist (not deleted).
  const toolId = row.toolId;
  if (toolId === null) {
    // A `kind = 'tool'` routine with no tool fails like a deleted tool.
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

  // Step 3: fewer hosts or a code-only change keep running; a new host pauses before any run.
  const currentHosts = await readCurrentHosts(db, toolId, tool.currentVersion);
  if (currentHosts === null) {
    await pauseForFailures(db, options, ports, row, at, startedAt, true);
    return;
  }
  if (!isSubset(currentHosts, row.approvedHosts)) {
    await pauseForHostsChanged(db, options, ports, row, at, startedAt);
    return;
  }

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
    // `ai_not_active` and `not_found` between checks and the run become skips; anything else is a run failure.
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

  // A linked alert card reads the numeric value; no number is a failure, below the threshold is `ok` and silent.
  if (row.alertCardId != null) {
    const verdict = alertVerdict(row.input, outputData);
    if (verdict.kind === 'error') {
      await recordFailure(db, options, ports, row, at, startedAt);
      return;
    }
    // The note says when it last checked and what it saw; a failed refresh never changes the outcome.
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

  // Step 5: post as the AI; `false` or a throw means stopped or out of the room, so retry once before `skipped`.
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
