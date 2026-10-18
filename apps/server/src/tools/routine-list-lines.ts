// The `tool.list` routine lines and pending `routine.schedule` approvals.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ActionContext } from '../actions/registry';
import { runSql } from '../effect/sql';
import type { PublicRoutine } from '../routines/schemas';
import type { AdapterState } from './adapter-support';
import { describeSchedule } from './routine-adapters';

// One line: `- <title> [id <first 8 chars>]: runs tool <name>, <schedule> [<status>]`, or `runs a prompt`.
export function routineLine(routine: PublicRoutine): string {
  const target =
    routine.kind === 'prompt'
      ? 'runs a prompt'
      : routine.toolName === ''
        ? 'runs a deleted tool'
        : `runs tool ${routine.toolName}`;
  return `- ${routine.title} [id ${routine.id.slice(0, 8)}]: ${target}, ${describeSchedule(routine.schedule)} [${routine.status}]`;
}

// One pending `routine.schedule` approval, using the card's summary so the model recognises it.
export function pendingApprovalLine(summary: string): string {
  return `- ${summary}: waiting for approval`;
}

// Pending, unexpired approvals of this AI in this topic, oldest first; `IS NOT DISTINCT FROM` matches the null pair for personal chats.
export async function pendingRoutineApprovals(
  state: AdapterState,
  ctx: ActionContext,
): Promise<string[]> {
  const rows = await runSql(
    state.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ summary: string }>`SELECT summary FROM approvals
        WHERE ai_id = ${ctx.aiId}
          AND action = 'routine.schedule'
          AND status = 'pending'
          AND expires_at > ${state.now()}
          AND topic_id IS NOT DISTINCT FROM ${ctx.topicId}
          AND group_id IS NOT DISTINCT FROM ${ctx.groupId}
        ORDER BY created_at ASC`;
    }),
  );
  return rows.map((row) => row.summary);
}
