// Account-deletion request and cancel (T-1261, task T-A of
// `docs/audit/account-deletion-plan.md` §9). This module owns the 7-day grace
// row in `user_deletions` (§5a): it schedules, reads and cancels it. It never
// deletes anything — the deletion job is task T-B, held for the plan's §8
// decisions.
//
// Audit entries carry ids only (§5d): `subject_id` is the user id, and the
// sign-in cancel adds `detail: { by: 'sign-in' }`. Nothing else.

import type { AuthDeletionStatus } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createAuditRecorder, type AuditLogger, type AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { SessionsDeps } from './sessions';
import { currentSession } from './sessions';

// The plan's §5a: `delete_after = requested_at + interval '7 days'`.
const DELETION_GRACE_DAYS = 7;

/**
 * The plan's §9 decision 9: the whole-account routes demand a session at most
 * 30 minutes old, stricter than Better Auth's 24 h `freshAge`. Shared by the
 * deletion request (below) and the export (T-1262).
 */
export const FRESH_SESSION_MS = 30 * 60 * 1000;

/** The name the deletion route and its tests already use. */
export const DELETION_FRESH_SESSION_MS = FRESH_SESSION_MS;

/** The 403 the fresh-session gate answers when the session is older than 30 min. */
export function assertFreshSession(createdAt: Date, nowMs: number, message: string): void {
  if (nowMs - createdAt.getTime() > FRESH_SESSION_MS) {
    throw new HttpError(403, 'reauth_required', message);
  }
}

/** The ready-to-deploy status the three routes answer. */
export const DELETION_NOT_SCHEDULED: AuthDeletionStatus = { scheduled: false };

export interface DeletionDeps extends SessionsDeps {
  audit: AuditRecorder;
  /** Injected in tests; the freshness window is measured against it. */
  now?: () => number;
}

interface DeletionRow {
  deleteAfter: Date;
}

/** The caller's grace status: scheduled with its date, or not scheduled. */
export async function deletionStatus(
  db: ServerDatabase,
  userId: string,
): Promise<AuthDeletionStatus> {
  const row = await findDeletion(db, userId);
  return row === undefined ? DELETION_NOT_SCHEDULED : scheduled(row.deleteAfter);
}

/**
 * Schedules the deletion seven days out and answers the status. It is
 * idempotent: `ON CONFLICT DO NOTHING` keeps the first `delete_after`, so a
 * second request never pushes the date back.
 */
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
    // Ids only: actor and subject are the user; no detail on the first request.
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

/**
 * Cancels the request and answers `{ scheduled: false }`. It is idempotent: a
 * user with no row still gets the same answer and no audit entry.
 */
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

/**
 * Better Auth's `session.create.after` hook: a successful sign-in cancels a
 * pending deletion (plan §5b). Best effort — a failure is logged and never
 * blocks the sign-in.
 */
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
