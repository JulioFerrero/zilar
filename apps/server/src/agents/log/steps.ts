// T-1530: the assembled "View steps" reader. `taskSteps` walks one turn's
// session-log rows in `seq` order and groups each tool call under the card step
// that was open when it ran, exactly as `task-card.ts` builds the card from the
// reported stages. The card's 20-step cap is honoured: a stage past it renames
// the last step instead of adding one. Owner-only: callers load the owner first
// and answer the same 404 for an unknown task and one the caller may not see.
//
// Never shown: `model_call`, `answer` and `error` rows, and the close markers
// (`card_done` / `card_failed` / `card_stopped` and the stop path's `stopped`).
// Only `status`, `tool_call` and `tool_result` rows shape the result.
import type { TaskStep, TaskStepAction, TaskSteps } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import type { AgentTaskEventRow } from '../../db/rows';
import { runSql } from '../../effect/sql';
import { TASK_CARD_MAX_STEPS } from '../task-card';

/** The most rows read for one task; a longer log is truncated to the first. */
export const TASK_STEPS_MAX_ROWS = 2000;

/** How many characters of a tool's command text travel to the panel. */
export const TASK_STEP_COMMAND_MAX_CHARS = 120;

/** A terminal `status` row's stage, mapped to the state it closes the card with. */
const CARD_CLOSE_STATES: Record<string, TaskStep['state']> = {
  card_done: 'done',
  card_failed: 'failed',
  card_stopped: 'stopped',
};

// An approval counts as granted when the decision was "approve" (once or
// always) or the action ran after approval (`consumed`). `pending` and `denied`
// do not.
const APPROVED_STATUSES = ['approved_once', 'approved_always', 'consumed'] as const;

// A stage that opens a step: not a `card_*` close marker and not the stop
// path's plain `stopped` marker.
function stepStage(row: AgentTaskEventRow): string | undefined {
  const stage = row.data.stage;
  if (typeof stage !== 'string') {
    return undefined;
  }
  if (stage.startsWith('card_') || stage === 'stopped') {
    return undefined;
  }
  return stage;
}

/** Milliseconds since the epoch for a row's timestamp. */
function timeOf(row: AgentTaskEventRow | undefined): number {
  return row === undefined ? 0 : new Date(row.at).getTime();
}

/** The card's close marker, when one was logged: its state and timestamp. */
function closeMarkerOf(
  rows: readonly AgentTaskEventRow[],
): { state: TaskStep['state']; at: number } | null {
  let found: { state: TaskStep['state']; at: number } | null = null;
  for (const row of rows) {
    if (row.kind !== 'status') {
      continue;
    }
    const stage = typeof row.data.stage === 'string' ? row.data.stage : undefined;
    const state = stage === undefined ? undefined : CARD_CLOSE_STATES[stage];
    if (state !== undefined) {
      found = { state, at: timeOf(row) };
    }
  }
  return found;
}

// Builds the step list from the filtered status rows (row 0 is the title, row
// k opens `step-k`; stages past the cap rename the last step). A step runs to
// the next step's `at`, and the last to the close marker or the last row.
function buildSteps(
  rows: readonly AgentTaskEventRow[],
  statusRows: readonly AgentTaskEventRow[],
  statusLabels: readonly string[],
): TaskStep[] {
  if (statusRows.length === 0) {
    return [];
  }
  const lastIndex = statusRows.length - 1;
  // A card with only its title still stands for one step of work.
  const count = statusRows.length === 1 ? 1 : Math.min(statusRows.length - 1, TASK_CARD_MAX_STEPS);
  const close = closeMarkerOf(rows);
  const endAt = close === null ? timeOf(rows[rows.length - 1]) : close.at;
  const steps: TaskStep[] = [];
  for (let index = 1; index <= count; index += 1) {
    // A stage past the cap renames the last step, exactly like the card, so
    // the last step takes the final stage's row as its source.
    const source = index === count ? lastIndex : index;
    const startAt = timeOf(statusRows[source]);
    const nextAt = index < count ? timeOf(statusRows[Math.min(index + 1, lastIndex)]) : endAt;
    steps.push({
      id: `step-${index}`,
      label: statusLabels[source] ?? '',
      state: index < count ? 'done' : (close?.state ?? 'doing'),
      durationMs: Math.max(0, nextAt - startAt),
      approved: false,
      actions: [],
    });
  }
  return steps;
}

/** The short `<tool> <args>` text a step row shows, cut to the cap. */
function commandOf(row: AgentTaskEventRow): string {
  const tool = typeof row.data.tool === 'string' ? row.data.tool : 'tool';
  const args = typeof row.data.args === 'string' ? row.data.args.trim() : '';
  return (args === '' ? tool : `${tool} ${args}`).slice(0, TASK_STEP_COMMAND_MAX_CHARS);
}

/** One action from its command text and the matching `tool_result` row. */
function actionOf(command: string, row: AgentTaskEventRow): TaskStepAction {
  const ok = row.data.ok === true;
  const output = row.data.output;
  return {
    command,
    ok,
    durationMs: row.durationMs ?? 0,
    ...(ok || typeof output !== 'string' ? {} : { error: output }),
  };
}

/** The approval a `tool_result` raised, when it carries one. */
function approvalIdOf(row: AgentTaskEventRow): string | undefined {
  const id = row.data.approval_id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

interface GroupedActions {
  /** One action list per step, in step order. */
  actions: TaskStepAction[][];
  /** One approval-id set per step, in step order. */
  approvalIds: Set<string>[];
}

// Walks the rows in `seq` order: a filtered status row moves the open step, a
// `tool_call` attaches to the step open at that moment (step 1 before any), and
// the next `tool_result` closes its action.
function groupActions(
  rows: readonly AgentTaskEventRow[],
  stepByRowId: Map<string, number>,
  stepCount: number,
): GroupedActions {
  const actions: TaskStepAction[][] = Array.from({ length: stepCount }, () => []);
  const approvalIds: Set<string>[] = Array.from({ length: stepCount }, () => new Set());
  const pending: Array<{ step: number; command: string }> = [];
  let current = 1;
  for (const row of rows) {
    if (row.kind === 'status') {
      const step = stepByRowId.get(row.id);
      if (step !== undefined) {
        current = step;
      }
      continue;
    }
    if (row.kind === 'tool_call') {
      pending.push({ step: current, command: commandOf(row) });
      continue;
    }
    if (row.kind !== 'tool_result') {
      continue;
    }
    const call = pending.shift();
    const index = (call?.step ?? current) - 1;
    if (call === undefined || index < 0 || index >= stepCount) {
      continue;
    }
    actions[index]?.push(actionOf(call.command, row));
    const approvalId = approvalIdOf(row);
    if (approvalId !== undefined) {
      approvalIds[index]?.add(approvalId);
    }
  }
  return { actions, approvalIds };
}

/** The ids of the given approvals that were granted, in one batched read. */
async function loadApprovedIds(db: ServerDatabase, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM approvals
        WHERE id IN ${sql.in(ids)} AND status IN ${sql.in([...APPROVED_STATUSES])}`;
    }),
  );
  return new Set(rows.map((row) => row.id));
}

/** Every row of a task in `seq` order, capped so one huge turn stays bounded. */
async function loadTaskRows(
  db: ServerDatabase,
  taskId: string,
): Promise<readonly AgentTaskEventRow[]> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AgentTaskEventRow>`SELECT id, task_id, ai_id, owner_id, chat_jid,
          seq, kind, at, duration_ms, data
        FROM agent_task_events
        WHERE task_id = ${taskId}
        ORDER BY seq ASC LIMIT ${TASK_STEPS_MAX_ROWS}`;
    }),
  );
}

/** The card's steps with their actions, durations, states and approvals. */
export async function taskSteps(db: ServerDatabase, taskId: string): Promise<TaskSteps> {
  const rows = await loadTaskRows(db, taskId);
  const statusRows: AgentTaskEventRow[] = [];
  const statusLabels: string[] = [];
  const stepByRowId = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'status') {
      continue;
    }
    const stage = stepStage(row);
    if (stage === undefined) {
      continue;
    }
    const index = statusRows.length;
    statusRows.push(row);
    statusLabels.push(stage);
    if (index >= 1) {
      stepByRowId.set(row.id, Math.min(index, TASK_CARD_MAX_STEPS));
    }
  }
  const steps = buildSteps(rows, statusRows, statusLabels);
  const { actions, approvalIds } = groupActions(rows, stepByRowId, steps.length);
  const granted = await loadApprovedIds(db, [...new Set(approvalIds.flatMap((set) => [...set]))]);
  return {
    steps: steps.map((step, index) => ({
      ...step,
      approved: [...(approvalIds[index] ?? [])].some((id) => granted.has(id)),
      actions: actions[index] ?? [],
    })),
  };
}
