import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createAuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { PendingActionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { errorName } from '../effect/error-utils';
import { cancelPending } from './queries';
import { buildRegistry } from './registry';

// An AI that left a group or topic must not have a waiting action fire later, even if a path decides it without a re-check.
export interface PendingActionScope {
  aiId: string;
  groupId: string;
  topicId?: string | undefined;
}

export interface PendingCancelLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// Same path as a decision: status, audit entry and optional notice; best effort after the removal already committed.
export async function cancelPendingActionsForAi(
  deps: { db: ServerDatabase; logger: PendingCancelLogger },
  scope: PendingActionScope,
  at: Date,
): Promise<void> {
  try {
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (scope.topicId === undefined) {
          return yield* sql<PendingActionRow>`SELECT * FROM pending_actions
            WHERE ai_id = ${scope.aiId} AND group_id = ${scope.groupId}
              AND status = 'waiting'
            ORDER BY created_at`;
        }
        return yield* sql<PendingActionRow>`SELECT * FROM pending_actions
          WHERE ai_id = ${scope.aiId} AND group_id = ${scope.groupId}
            AND topic_id = ${scope.topicId} AND status = 'waiting'
          ORDER BY created_at`;
      }),
    );
    if (rows.length === 0) {
      return;
    }
    const cancelDeps = {
      db: deps.db,
      adapters: buildRegistry([]),
      audit: createAuditRecorder({ db: deps.db, logger: { error: deps.logger.warn } }),
      logger: { warn: deps.logger.warn, error: deps.logger.warn },
    };
    for (const row of rows) {
      await cancelPending(cancelDeps, row, 'ai_not_in_topic', at);
    }
  } catch (error) {
    deps.logger.warn(
      { aiId: scope.aiId, groupId: scope.groupId, err: errorName(error) },
      'could not cancel the pending actions of an AI that left',
    );
  }
}
