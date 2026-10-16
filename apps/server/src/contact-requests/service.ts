// Contact requests (T-0163): adding by `@username` sends a request the
// other person must accept. Unknown handles, retired handles and
// not-allowed requests answer the same 404 wherever specified.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
//
// T-0983 size split: the shared types, limits and query helpers live in
// `./queries`, the public reads in `./reads`, the error helpers in
// `./errors` and the decisions (accept, decline and cancel) in `./decide`.
// This path keeps the mutating service functions and re-exports the same
// public names it always did.

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

// Creates a pending request `fromId -> handle`. Refuses: to yourself (400),
// to an existing contact (409 `already_contact`), a duplicate pending
// request in either direction (409 `request_exists` — the reverse request is
// returned so the web can offer "Accept"), more than 20 pending outgoing
// (429), a re-request within 7 days after a decline (429
// `declined_recently`). The target-handle resolve, the contact check, the
// duplicate and cooldown reads, the outgoing-cap count and the insert all
// run in one transaction under the per-sender advisory lock, so the check-
// then-act cannot double-create under concurrency and a racing accept
// cannot leave a stale pending row behind: the in-transaction contact read
// sees the committed pair.
//
// Race recovery lives OUTSIDE the transaction (see below): on real Postgres
// a unique violation aborts the tx, so any read issued on it afterwards
// fails with 25P02. The same-direction backstop is the partial unique
// index, the opposite-direction backstop is the unordered-pair index.
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
            // The handle is resolved INSIDE the transaction, under the sender
            // lock: a handle that moved (or an account deleted) between the
            // HTTP layer and here must answer the same 404, never a 500 from a
            // dangling FK insert. The per-pair key below is folded into the
            // sender lock's critical section instead of a second take (PGlite
            // has one connection per database: two concurrent advisory takes
            // on it would self-deadlock).
            const target = yield* resolveHandleUser(sql, handle);
            targetId = target.id;
            if (target.id === fromId) {
              return yield* Effect.fail(
                new HttpError(400, 'invalid_request', 'You cannot add yourself'),
              );
            }
            // Block effects are silent: when the target blocked the sender,
            // the request is stored `declined` but answers exactly like a
            // normal new request (the route still returns 201 with
            // `status: pending` to the sender). When the sender blocked the
            // target, they must unblock first (409 `blocked`).
            const [blockedByTarget] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
              WHERE user_id = ${target.id} AND blocked_user_id = ${fromId} LIMIT 1`;
            const [blockedBySender] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
              WHERE user_id = ${fromId} AND blocked_user_id = ${target.id} LIMIT 1`;
            if (blockedBySender) {
              return yield* Effect.fail(new HttpError(409, 'blocked', 'Unblock this person first'));
            }
            const silentDecline = blockedByTarget !== undefined;
            // The duplicate check serializes on the sender lock taken above
            // (same critical section as the cap count), so no second lock
            // order exists to deadlock.

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
              // The other side already asked: answer with that request so the
              // web can offer "Accept" instead of creating a second row.
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

            // The 7-day re-request cooldown: the single most recent decline of
            // this exact direction (`ORDER BY decided_at DESC LIMIT 1` — no
            // unbounded read), INSIDE the transaction like every other row this
            // decision depends on. Silent declines (the target blocked the
            // sender) skip it: they must keep answering like fresh requests,
            // never 429.
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
    // Audited after the commit: a rolled-back create leaves no audit row.
    // Only a fresh row has no `reverseOf`.
    if (created.reverseOf === undefined) {
      auditFor(deps, 'contact_request.created', fromId, created.request.id);
    }
    // Silent to the sender: a request stored `declined` because the target
    // blocked them answers like a normal new pending request — `pending`
    // with no `decidedAt` — while the stored row stays `declined`.
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
    // A concurrent create won the race and this transaction aborted with a
    // unique violation (on real Postgres the tx is dead from here on, so
    // the recovery reads MUST use `deps.db`, a fresh connection — never the
    // aborted tx). Same-direction loser: the partial unique index fired.
    // Opposite-direction loser: the unordered-pair index fired. Either way
    // re-read the authoritative row outside and answer like the pre-check:
    // the reverse-direction loser returns the winner's row so its caller
    // can offer "Accept" exactly like the serial reverse case.
    const resolvedTargetId = targetId;
    if (!isPendingPairViolation(error) || resolvedTargetId === undefined) {
      throw error;
    }
    // The recovery reads run on `deps.db` (a fresh connection): the test seam
    // fires here and can commit the winner the aborted transaction never saw.
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
