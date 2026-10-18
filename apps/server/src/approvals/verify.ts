import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { safeHashEquals } from './access';
import { toApprovalRow, type ApprovalSqlRow } from './queries';
import type { ApprovalDecision } from './schemas';

export interface ApprovalVerifyResult {
  ok: boolean;
  decision?: ApprovalDecision;
}

// Only an unexpired `approved_once`/`approved_always` with a matching hash
// verifies, and the hash is compared with `timingSafeEqual` so the answer leaks
// nothing. The conditional flip to `consumed` makes a second call fail. Every
// other state returns `{ ok: false }` with no detail.
export async function verifyApproval(
  db: ServerDatabase,
  params: { approvalId: string; argsHash: string },
  now: Date,
): Promise<ApprovalVerifyResult> {
  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${params.approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return { ok: false };
  }
  const row = toApprovalRow(rawRow);
  if (row.status !== 'approved_once' && row.status !== 'approved_always') {
    return { ok: false };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  if (!safeHashEquals(row.argsHash, params.argsHash)) {
    return { ok: false };
  }

  const [consumed] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE approvals SET status = 'consumed'
        WHERE id = ${row.id} AND status = ${row.status} RETURNING id`;
    }),
  );
  if (!consumed) {
    return { ok: false };
  }
  return {
    ok: true,
    decision: row.status === 'approved_always' ? 'approve_always' : 'approve_once',
  };
}
