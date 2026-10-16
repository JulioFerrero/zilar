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

// Verifies an approval for the engine. Returns `{ ok: true, decision }` only
// when the request is `approved_once` or `approved_always`, unexpired, and
// `argsHash` matches the stored hash (compared with `timingSafeEqual` so the
// answer cannot be used to recover the hash byte by byte). For both
// approvals the status is flipped to `consumed` with a conditional update so a second
// call fails. Any other state — wrong hash, not decided, denied, expired,
// already consumed — returns `{ ok: false }` with no detail.
//
// `approved_always` is treated like `approved_once` here on purpose: standing
// rules (always-allow for one action across requests) are a separate spec and
// the current behaviour is to make every approval consume.
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
