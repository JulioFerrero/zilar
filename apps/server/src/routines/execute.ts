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
import { and, eq } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, aiTools, aiToolVersions, groupAis, routines, topicAis, topics } from '../db/schema';
import { runToolVersion, ToolServiceError } from '../tools/service';
import type { ToolRunner } from '../tools/types';

export const MAX_POST_TEXT_CHARS = 4_000;
export const MAX_CONSECUTIVE_FAILURES = 3;

export const FAILURE_PAUSE_NOTICE = (title: string): string =>
  `The routine "${title}" was paused after 3 failed runs. Ask me to fix it.`;

export const HOSTS_CHANGED_NOTICE = (title: string): string =>
  `The routine "${title}" is paused: its tool now contacts new sites. Ask me to schedule it again to approve them.`;

export type RoutineRow = typeof routines.$inferSelect;

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
  const [ai] = await db
    .select({ status: ais.status })
    .from(ais)
    .where(eq(ais.id, row.aiId))
    .limit(1);
  if (!ai || ai.status !== 'active') {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }
  if (row.topicId !== null && !(await isAiInTopicRoom(db, row))) {
    await markSkipped(db, options, row, at, startedAt);
    return;
  }

  // Step 2: the tool must exist (not deleted).
  const [tool] = await db
    .select({ deletedAt: aiTools.deletedAt, currentVersion: aiTools.currentVersion })
    .from(aiTools)
    .where(eq(aiTools.id, row.toolId))
    .limit(1);
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
// topics read `group_ais`, other topics read the (AI, topic) row in
// `topic_ais`. An archived topic's room is gone, so the routine skips.
async function isAiInTopicRoom(db: ServerDatabase, row: RoutineRow): Promise<boolean> {
  const [topic] = await db
    .select({ isGeneral: topics.isGeneral, archivedAt: topics.archivedAt })
    .from(topics)
    .where(eq(topics.id, row.topicId as string))
    .limit(1);
  if (!topic || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    const [match] = await db
      .select({ aiId: groupAis.aiId })
      .from(groupAis)
      .where(and(eq(groupAis.groupId, row.groupId as string), eq(groupAis.aiId, row.aiId)))
      .limit(1);
    return match !== undefined;
  }
  const [match] = await db
    .select({ aiId: topicAis.aiId })
    .from(topicAis)
    .where(and(eq(topicAis.topicId, row.topicId as string), eq(topicAis.aiId, row.aiId)))
    .limit(1);
  return match !== undefined;
}

async function readCurrentHosts(
  db: ServerDatabase,
  toolId: string,
  currentVersion: number,
): Promise<string[] | null> {
  const [version] = await db
    .select({ hosts: aiToolVersions.hosts })
    .from(aiToolVersions)
    .where(and(eq(aiToolVersions.toolId, toolId), eq(aiToolVersions.version, currentVersion)))
    .limit(1);
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
  await db
    .update(routines)
    .set({ lastRunAt: at, lastStatus: 'skipped', updatedAt: at })
    .where(eq(routines.id, row.id));
  await auditRun(options, row, 'skipped', startedAt);
}

async function markOk(
  db: ServerDatabase,
  options: ExecuteRoutineOptions,
  row: RoutineRow,
  at: Date,
  startedAt: number,
): Promise<void> {
  await db
    .update(routines)
    .set({ lastRunAt: at, lastStatus: 'ok', consecutiveFailures: 0, updatedAt: at })
    .where(eq(routines.id, row.id));
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
  await db
    .update(routines)
    .set({
      lastRunAt: at,
      lastStatus: 'error',
      consecutiveFailures: failures,
      ...(pausing ? { status: 'paused', pausedReason: 'failures' } : {}),
      updatedAt: at,
    })
    .where(eq(routines.id, row.id));
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
  await db
    .update(routines)
    .set({
      status: 'needs_approval',
      pausedReason: 'hosts_changed',
      lastRunAt: at,
      lastStatus: 'skipped',
      updatedAt: at,
    })
    .where(eq(routines.id, row.id));
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
