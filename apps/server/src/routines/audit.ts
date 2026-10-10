// effect-plain: moved unchanged from apps/server/src/routines/execute.ts (size split)
// T-1028: size split of `routines/execute.ts`. The two audit entries one run
// writes (`routine.run`, `routine.paused`) live here; the old path stays the
// barrel. Both carry ids and a fixed detail only, never output text or errors.
import type { RoutineRow } from '../db/rows';
import type { ExecuteRoutineOptions } from './execute';

export async function auditRun(
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

export async function auditPaused(
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
