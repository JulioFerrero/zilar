import { randomBytes } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { decodeEntry, type AuditEntry } from './schema';

// Minimal slice of pino's Logger the recorder needs. Real call sites pass the
// server's own logger; tests can pass a captor.
export interface AuditLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface AuditRecorder {
  record: (entry: AuditEntry) => Promise<void>;
}

// A recorder wraps `recordAudit` so a database failure never propagates into
// the caller's request. The error log intentionally only carries `{ action }`:
// `detail`, `actor_user_id`, `ai_id` and friends are not echoed because the
// audit log's whole point is to keep sensitive data out of write paths.
export interface CreateAuditRecorderInput {
  db: ServerDatabase;
  logger?: AuditLogger;
  now?: () => Date;
}

export function createAuditRecorder({
  db,
  logger,
  now = () => new Date(),
}: CreateAuditRecorderInput): AuditRecorder {
  return {
    async record(entry: AuditEntry): Promise<void> {
      try {
        await recordAudit(db, entry, now());
      } catch (error) {
        if (logger !== undefined) {
          logger.error({ action: entry.action, err: error }, 'audit write failed; carrying on');
        }
      }
    },
  };
}

// Validates the entry at the boundary, then inserts one row. Callers that
// must not fail on an audit write wrap this in `createAuditRecorder`. The
// `now` parameter is injectable so tests can pin the timestamp.
export async function recordAudit(db: ServerDatabase, entry: AuditEntry, now: Date): Promise<void> {
  const parsed = decodeEntry(entry);
  const id = randomId();
  const costAmount = parsed.costAmount === null ? null : parsed.costAmount.toFixed(2);
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // jsonb is written as a cast string, or NULL when there is no detail.
      const detail =
        parsed.detail === null ? sql`NULL` : sql`${JSON.stringify(parsed.detail)}::jsonb`;
      yield* sql`INSERT INTO audit_log (
          id, at, actor_user_id, ai_id, group_id, action, subject_id, args_hash,
          cost_currency, cost_amount, result, detail
        ) VALUES (
          ${id}, ${now}, ${parsed.actorUserId}, ${parsed.aiId}, ${parsed.groupId},
          ${parsed.action}, ${parsed.subjectId}, ${parsed.argsHash},
          ${parsed.costCurrency}, ${costAmount}, ${parsed.result}, ${detail}
        )`;
    }),
  );
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}
