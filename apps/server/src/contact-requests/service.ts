// Adding by `@username` sends a request the other person must accept. An unknown
// handle, a retired one and a not-allowed request answer the same 404.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { isPendingPairViolation } from './errors';
import {
  auditFor,
  isContactEffect,
  MAX_PENDING_OUTGOING,
  pendingBetweenEffect,
  RE_REQUEST_COOLDOWN_DAYS,
  resolveHandleUser,
  serviceNow,
  type ContactRequestRow,
  type ContactRequestsDeps,
} from './queries';

export { MAX_LIST_ROWS } from './queries';
export {
  isPendingPairViolation,
  MAX_PENDING_OUTGOING,
  RE_REQUEST_COOLDOWN_DAYS,
  resolveHandleUser,
};
export type { ContactRequestsDeps };
export { listContactRequests, profileForHandle, relationFor } from './reads';
export type { OtherUserProfile } from './reads';
export { acceptContactRequest, cancelContactRequest, declineContactRequest } from './decide';
export type { ContactRequestRow, ContactRequestStatus, ContactRequestView } from './queries';

// Refuses self, an existing contact, a pending request in either direction, more
// than 20 pending outgoing, and a re-request within 7 days of a decline. Every
// check and the insert share one transaction under the per-sender advisory lock,
// so check-then-act cannot double-create.
//
// Recovery reads run outside the transaction: a unique violation aborts it, so
// any later read fails with 25P02.
export async function createContactRequest(
  deps: ContactRequestsDeps,
  fromId: string,
  handle: string,
): Promise<{ request: ContactRequestRow; reverseOf?: ContactRequestRow }> {
  const now = serviceNow(deps);

  let targetId: string | undefined;
  try {
    const created = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-sender:' + fromId}))`;
            // Resolved inside the transaction: a handle that moved must answer the
            // same 404, never a 500 from a dangling FK. The per-pair key is folded
            // into this lock because PGlite has one connection and a second
            // concurrent take would self-deadlock.
            const target = yield* resolveHandleUser(sql, handle);
            targetId = target.id;
            if (target.id === fromId) {
              return yield* Effect.fail(
                new HttpError(400, 'invalid_request', 'You cannot add yourself'),
              );
            }
            // Silent block: when the target blocked the sender, the row is stored
            // `declined` but answers like a normal new request. A sender who blocked
            // the target must unblock first (409).
            const [blockedByTarget] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
              WHERE user_id = ${target.id} AND blocked_user_id = ${fromId} LIMIT 1`;
            const [blockedBySender] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
              WHERE user_id = ${fromId} AND blocked_user_id = ${target.id} LIMIT 1`;
            if (blockedBySender) {
              return yield* Effect.fail(new HttpError(409, 'blocked', 'Unblock this person first'));
            }
            const silentDecline = blockedByTarget !== undefined;

            if (yield* isContactEffect(sql, fromId, target.id)) {
              return yield* Effect.fail(
                new HttpError(409, 'already_contact', 'You are already contacts'),
              );
            }

            const outgoingFirst = yield* pendingBetweenEffect(sql, fromId, target.id);
            if (outgoingFirst && outgoingFirst.fromUserId === fromId) {
              return yield* Effect.fail(
                new HttpError(409, 'request_exists', 'A request is already pending'),
              );
            }
            if (outgoingFirst) {
              // The other side already asked: return it so the web can offer
              // "Accept" instead of creating a second row.
              return { request: outgoingFirst, reverseOf: outgoingFirst };
            }

            const [outgoing] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM contact_requests
              WHERE from_user_id = ${fromId} AND status = 'pending'`;
            if (Number(outgoing?.total ?? 0) >= MAX_PENDING_OUTGOING) {
              return yield* Effect.fail(
                new HttpError(429, 'too_many_requests', 'Too many pending requests'),
              );
            }

            // Only the single most recent decline of this direction, inside the
            // transaction. A silent decline skips it: it must answer like a fresh
            // request, never 429.
            if (!silentDecline) {
              const [lastDeclined] = yield* sql<{ decidedAt: Date | null }>`SELECT decided_at
                FROM contact_requests
                WHERE from_user_id = ${fromId} AND to_user_id = ${target.id} AND status = 'declined'
                ORDER BY decided_at DESC LIMIT 1`;
              if (
                lastDeclined?.decidedAt &&
                now.getTime() - lastDeclined.decidedAt.getTime() <
                  RE_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
              ) {
                return yield* Effect.fail(
                  new HttpError(429, 'declined_recently', 'That request was declined recently'),
                );
              }
            }

            deps.onInsert?.();
            const [row] = yield* sql<ContactRequestRow>`INSERT INTO contact_requests
                (id, from_user_id, to_user_id, status, created_at, decided_at)
              VALUES (
                ${randomUUID()},
                ${fromId},
                ${target.id},
                ${silentDecline ? 'declined' : 'pending'},
                ${now.toISOString()},
                ${silentDecline ? now.toISOString() : null}
              )
              RETURNING *`;
            if (!row) {
              return yield* Effect.die(new Error('contact request insert returned no row'));
            }
            return { request: row };
          }),
        );
      }),
    );
    // After the commit, so a rolled-back create leaves no audit row. Only a fresh
    // row has no `reverseOf`.
    if (created.reverseOf === undefined) {
      auditFor(deps, 'contact_request.created', fromId, created.request.id);
    }
    // A row stored `declined` because the target blocked the sender answers like a
    // normal pending request, while the stored row stays `declined`.
    if (created.request.status === 'declined') {
      return {
        ...created,
        request: { ...created.request, status: 'pending' as const, decidedAt: null },
      };
    }
    return created;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    // A concurrent create won and this transaction aborted, so the recovery reads
    // MUST use `deps.db` (a fresh connection), never the dead one. Re-read the
    // authoritative row and answer like the pre-check: a reverse-direction loser
    // returns the winner's row so its caller can offer "Accept".
    const resolvedTargetId = targetId;
    if (!isPendingPairViolation(error) || resolvedTargetId === undefined) {
      throw error;
    }
    // The test seam fires here and can commit the winner the aborted tx never saw.
    await deps.onRecovery?.();
    const raced = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
          WHERE from_user_id = ${fromId} AND to_user_id = ${resolvedTargetId}
            AND status = 'pending' LIMIT 1`;
        return row ?? null;
      }),
    );
    if (raced) {
      throw new HttpError(409, 'request_exists', 'A request is already pending');
    }
    const reverse = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* pendingBetweenEffect(sql, fromId, resolvedTargetId);
      }),
    );
    if (reverse && reverse.fromUserId !== fromId) {
      return { request: reverse, reverseOf: reverse };
    }
    if (reverse) {
      throw new HttpError(409, 'request_exists', 'A request is already pending');
    }
    throw error;
  }
}
