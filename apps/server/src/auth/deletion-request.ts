// The 7-day grace row in `user_deletions`: schedules, reads and cancels it, never deletes anything.
// Audit entries carry ids only: `subject_id` is the user id, and the sign-in cancel adds `detail: { by: 'sign-in' }`.

import type { AuthDeletionStatus } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createAuditRecorder, type AuditLogger, type AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { SessionsDeps } from './sessions';
import { currentSession } from './sessions';

// `delete_after = requested_at + interval '7 days'`.
const DELETION_GRACE_DAYS = 7;

// Whole-account routes demand a session at most 30 minutes old, stricter than Better Auth's 24 h.
export const FRESH_SESSION_MS = 30 * 60 * 1000;

export function assertFreshSession(createdAt: Date, nowMs: number, message: string): void {
  if (nowMs - createdAt.getTime() > FRESH_SESSION_MS) {
    throw new HttpError(403, 'reauth_required', message);
  }
}

export const DELETION_NOT_SCHEDULED: AuthDeletionStatus = { scheduled: false };

export interface DeletionDeps extends SessionsDeps {
  audit: AuditRecorder;
  now?: () => number;
}

interface DeletionRow {
  deleteAfter: Date;
}

export async function deletionStatus(
  db: ServerDatabase,
  userId: string,
): Promise<AuthDeletionStatus> {
  const row = await findDeletion(db, userId);
  return row === undefined ? DELETION_NOT_SCHEDULED : scheduled(row.deleteAfter);
}

// Idempotent: `ON CONFLICT DO NOTHING` keeps the first `delete_after`, so a second request never pushes it back.
export async function requestDeletion(
  deps: DeletionDeps,
  userId: string,
  headers: Headers,
): Promise<AuthDeletionStatus> {
  const now = deps.now ?? Date.now;
  const session = await currentSession(deps.auth, headers);
  assertFreshSession(session.createdAt, now(), 'Sign in again to delete your account.');
  const inserted = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<DeletionRow>`INSERT INTO user_deletions (user_id, delete_after)
        VALUES (${userId}, now() + ${DELETION_GRACE_DAYS} * interval '1 day')
        ON CONFLICT (user_id) DO NOTHING
        RETURNING delete_after AS "deleteAfter"`;
    }),
  );
  const [insertedRow] = inserted;
  if (insertedRow !== undefined) {
    // Ids only: actor and subject are the user.
    await deps.audit.record({
      actorUserId: userId,
      aiId: null,
      groupId: null,
      action: 'account.deletion_requested',
      subjectId: userId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return scheduled(insertedRow.deleteAfter);
  }
  const row = await findDeletion(deps.db, userId);
  return row === undefined ? DELETION_NOT_SCHEDULED : scheduled(row.deleteAfter);
}

// Idempotent: a user with no row gets the same answer and no audit entry.
export async function cancelDeletion(
  deps: { db: ServerDatabase; audit: AuditRecorder },
  userId: string,
  detail: Record<string, unknown> | null,
): Promise<AuthDeletionStatus> {
  const deleted = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`DELETE FROM user_deletions
        WHERE user_id = ${userId}
        RETURNING user_id AS "userId"`;
    }),
  );
  if (deleted.length > 0) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: null,
      groupId: null,
      action: 'account.deletion_cancelled',
      subjectId: userId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail,
    });
  }
  return DELETION_NOT_SCHEDULED;
}

// A successful sign-in cancels a pending deletion; best effort, never blocks the sign-in.
export async function cancelDeletionOnSignIn(
  db: ServerDatabase,
  logger: AuditLogger | undefined,
  userId: string,
): Promise<void> {
  try {
    const audit = createAuditRecorder(logger === undefined ? { db } : { db, logger });
    await cancelDeletion({ db, audit }, userId, { by: 'sign-in' });
  } catch (error) {
    logger?.error({ userId, err: error }, 'could not cancel the account deletion on sign-in');
  }
}

async function findDeletion(db: ServerDatabase, userId: string): Promise<DeletionRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<DeletionRow>`SELECT delete_after AS "deleteAfter"
        FROM user_deletions WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row;
}

function scheduled(deleteAfter: Date): AuthDeletionStatus {
  return { scheduled: true, deleteAfter: toIso(deleteAfter) };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
