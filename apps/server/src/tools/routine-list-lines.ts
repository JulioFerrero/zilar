// T-1737: the `tool.list` routine lines, and the pending `routine.schedule`
// approvals that read as "waiting for approval". Split out of
// `tool-adapters.ts` so that file stays under the size ceiling.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ActionContext } from '../actions/registry';
import { runSql } from '../effect/sql';
import type { PublicRoutine } from '../routines/service';
import type { AdapterState } from './adapter-support';
import { describeSchedule } from './routine-adapters';

// One routine line: `- <title> [id <first 8 chars>]: runs tool <name>, <schedule> [<status>]`,
// or `runs a prompt` for a prompt routine.
export function routineLine(routine: PublicRoutine): string {
  const target =
    routine.kind === 'prompt'
      ? 'runs a prompt'
      : routine.toolName === ''
        ? 'runs a deleted tool'
        : `runs tool ${routine.toolName}`;
  return `- ${routine.title} [id ${routine.id.slice(0, 8)}]: ${target}, ${describeSchedule(routine.schedule)} [${routine.status}]`;
}

// One pending `routine.schedule` approval of this AI in this topic. The
// summary is the card's summary, so the model can recognise the request it
// already raised.
export function pendingApprovalLine(summary: string): string {
  return `- ${summary}: waiting for approval`;
}

// The pending, unexpired `routine.schedule` approval summaries of this AI in
// this topic, oldest first. Personal chat = both `topicId` and `groupId`
// null; group chat = exact topic match. `IS NOT DISTINCT FROM` compares the
// nullable columns so a personal chat matches only the null pair.
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
