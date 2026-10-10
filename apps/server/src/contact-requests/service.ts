// Contact requests (T-0163): adding by `@username` sends a request the
// other person must accept. Unknown handles, retired handles and
// not-allowed requests answer the same 404 wherever specified.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { addContactPair, syncRoster } from '../contacts/service';
import { normalizeHandle } from '../handles/rules';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const MAX_PENDING_OUTGOING = 20;
export const RE_REQUEST_COOLDOWN_DAYS = 7;
// The list endpoint caps each side server-side; the outgoing cap above is
// the binding one, so 100 newest per side is headroom, not a limit anyone
// should hit.
export const MAX_LIST_ROWS = 100;

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ContactRequestRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ContactRequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface ContactRequestView {
  id: string;
  status: ContactRequestStatus;
  createdAt: string;
  other: { userId: string; name: string; handle: string | null; image: string | null };
}

export interface ContactRequestsDeps {
  db: ServerDatabase;
  audit?: AuditRecorder;
  adminClient?: EjabberdAdminClient;
  domain?: string;
  /** Override the clock in tests. Defaults to the wall clock. */
  now?: () => Date;
  /**
   * Test-only seam: called inside the create transaction immediately before
   * the insert. A test throws a pair-index unique violation here to reach the
   * recovery path, which PGlite cannot reproduce by racing (it serializes on
   * one connection). Never set in production.
   */
  onInsert?: () => void;
  /**
   * Test-only seam: called on the fresh connection before the recovery reads.
   * A test uses it to trace the recovery reads and to commit the concurrent
   * winner that landed between the pre-check and the insert. Never set in
   * production.
   */
  onRecovery?: () => void | Promise<void>;
}

// Resolves an exact, case-insensitive handle to its user row under the
// caller's transaction connection. Unknown and retired handles answer the
// same 404 `not_found`, so failures never reveal which one it was. There is
// deliberately no prefix or partial search.
export function resolveHandleUser(
  sql: SqlClient.SqlClient,
  handle: string,
): Effect.Effect<{ id: string }, HttpError | SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<{ userId: string | null }>`SELECT user_id FROM handles
      WHERE handle_lower = ${normalizeHandle(handle.trim())} LIMIT 1`;
    if (!row || !row.userId) {
      return yield* Effect.fail(new HttpError(404, 'not_found', 'No user with that username'));
    }
    return { id: row.userId };
  });
}

function serviceNow(deps: ContactRequestsDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

function auditFor(
  deps: ContactRequestsDeps,
  action: string,
  actorUserId: string,
  subjectId: string,
): void {
  void deps.audit?.record({
    actorUserId,
    aiId: null,
    groupId: null,
    action,
    subjectId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
}

function isContactEffect(
  sql: SqlClient.SqlClient,
  userId: string,
  otherId: string,
): Effect.Effect<boolean, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<{ userId: string }>`SELECT user_id FROM contacts
      WHERE user_id = ${userId} AND contact_user_id = ${otherId} LIMIT 1`;
    return row !== undefined;
  });
}

function pendingBetweenEffect(
  sql: SqlClient.SqlClient,
  firstId: string,
  secondId: string,
): Effect.Effect<ContactRequestRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [forward] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
      WHERE from_user_id = ${firstId} AND to_user_id = ${secondId} AND status = 'pending'
      LIMIT 1`;
    if (forward) {
      return forward;
    }
    const [reverse] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
      WHERE from_user_id = ${secondId} AND to_user_id = ${firstId} AND status = 'pending'
      LIMIT 1`;
    return reverse ?? null;
  });
}

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

// Whether `error` is a unique violation on one of the pending-request
// indexes: either the structured `effect/sql` `UniqueViolation` reason (which
// carries the constraint identifier) or a plain `{ code: '23505', constraint }`
// object (plain driver errors and the recovery test's doubles).
// Matched by code/constraint — never by message text.
export function isPendingPairViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    const reason = error.reason;
    return (
      reason._tag === 'UniqueViolation' &&
      (reason.constraint === undefined ||
        reason.constraint === 'contact_requests_pending_idx' ||
        reason.constraint === 'contact_requests_pending_pair_idx')
    );
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return (
        record.constraint === undefined ||
        record.constraint === 'contact_requests_pending_idx' ||
        record.constraint === 'contact_requests_pending_pair_idx'
      );
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}

function toView(
  row: ContactRequestRow,
  viewerId: string,
  profileByUser: Map<string, { name: string; image: string | null; handle: string | null }>,
): ContactRequestView {
  const otherId = row.fromUserId === viewerId ? row.toUserId : row.fromUserId;
  const profile = profileByUser.get(otherId);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    other: {
      userId: otherId,
      name: profile?.name ?? 'Unnamed user',
      handle: profile?.handle ?? null,
      image: profile?.image ?? null,
    },
  };
}

// Lists the viewer's pending requests, newest first: `{ incoming, outgoing }`
// with the other person's name, handle and image. Never an email. Incoming
// requests from people the viewer blocked are never listed. Names, images
// and handles resolve in ONE joined query over the distinct other ids —
// never one select per row.
export async function listContactRequests(
  deps: ContactRequestsDeps,
  viewerId: string,
): Promise<{ incoming: ContactRequestView[]; outgoing: ContactRequestView[] }> {
  const { blockedSenders, sent, received } = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const blockedSenders = yield* sql<{ blockedUserId: string }>`SELECT blocked_user_id
        FROM user_blocks WHERE user_id = ${viewerId}`;
      const sent = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
        WHERE from_user_id = ${viewerId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT ${MAX_LIST_ROWS}`;
      const received = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
        WHERE to_user_id = ${viewerId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT ${MAX_LIST_ROWS}`;
      return { blockedSenders, sent, received };
    }),
  );
  const blocked = new Set(blockedSenders.map((row) => row.blockedUserId));
  const visibleIncoming = received.filter((row) => !blocked.has(row.fromUserId));
  const rows = [...sent, ...visibleIncoming].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const otherIds = [
    ...new Set(rows.map((row) => (row.fromUserId === viewerId ? row.toUserId : row.fromUserId))),
  ];
  const profileByUser = await runSql(deps.db, profilesByUserEffect(otherIds));
  const incoming: ContactRequestView[] = [];
  const outgoing: ContactRequestView[] = [];
  for (const row of rows) {
    const view = toView(row, viewerId, profileByUser);
    if (row.toUserId === viewerId) {
      incoming.push(view);
    } else {
      outgoing.push(view);
    }
  }
  return { incoming, outgoing };
}

// One joined query for every distinct other party: display name + image
// from `user`, handle from `handles`. Missing users (deleted between the
// list read and here — nearly impossible inside one request) fall back to
// the `toView` defaults.
function profilesByUserEffect(
  otherIds: string[],
): Effect.Effect<
  Map<string, { name: string; image: string | null; handle: string | null }>,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const byUser = new Map<string, { name: string; image: string | null; handle: string | null }>();
    if (otherIds.length === 0) {
      return byUser;
    }
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      userId: string;
      name: string;
      image: string | null;
      handle: string | null;
    }>`SELECT u.id AS user_id, u.name, u.image, h.handle
      FROM "user" u
      LEFT JOIN handles h ON h.user_id = u.id
      WHERE u.id IN ${sql.in([...new Set(otherIds)])}`;
    for (const row of rows) {
      const name = row.name.trim() === '' ? 'Unnamed user' : row.name;
      byUser.set(row.userId, { name, image: row.image, handle: row.handle });
    }
    return byUser;
  });
}

function findActionableEffect(
  sql: SqlClient.SqlClient,
  id: string,
  viewerId: string,
  side: 'to' | 'from',
): Effect.Effect<ContactRequestRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const statement =
      side === 'to'
        ? sql<ContactRequestRow>`SELECT * FROM contact_requests
            WHERE id = ${id} AND to_user_id = ${viewerId} LIMIT 1`
        : sql<ContactRequestRow>`SELECT * FROM contact_requests
            WHERE id = ${id} AND from_user_id = ${viewerId} LIMIT 1`;
    const [row] = yield* statement;
    return row ?? null;
  });
}

// Accepts a request (recipient only). The status flip runs in a transaction
// under a per-request advisory lock, so a double click flips once and a
// failure before the flip leaves nothing behind. The contact-pair creation
// and roster sync follow outside the transaction but are idempotent: every
// re-accept of an `accepted` row re-runs them, so a half-finished first
// accept (flipped but pair missing) repairs on retry.
// Creates the mutual contact exactly like an invite does (the shared
// `addContactPair` + roster sync with the same retry).
export async function acceptContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  const existing = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* findActionableEffect(sql, id, viewerId, 'to');
    }),
  );
  if (!existing) {
    throw notFound();
  }
  if (existing.status !== 'pending' && existing.status !== 'accepted') {
    throw notFound();
  }
  const now = serviceNow(deps);

  let flippedNow = false;
  const settled = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-accept:' + id}))`;

          const [current] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
            WHERE id = ${id} AND to_user_id = ${viewerId} LIMIT 1`;
          if (!current) {
            return yield* Effect.fail(notFound());
          }
          if (current.status !== 'pending' && current.status !== 'accepted') {
            return yield* Effect.fail(notFound());
          }
          if (current.status === 'pending') {
            const [flipped] = yield* sql<ContactRequestRow>`UPDATE contact_requests
              SET status = 'accepted', decided_at = ${now.toISOString()}
              WHERE id = ${id} AND status = 'pending'
              RETURNING *`;
            if (!flipped) {
              // A concurrent decision won the race: re-read so an accepted row
              // still answers idempotently instead of 404ing.
              const [raced] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
                WHERE id = ${id} LIMIT 1`;
              if (raced && raced.status === 'accepted') {
                return raced;
              }
              return yield* Effect.fail(notFound());
            }
            flippedNow = true;
            return flipped;
          }
          return current;
        }),
      );
    }),
  );

  // Idempotent repair: re-runs on every accept of an accepted row, so a
  // half-finished first accept (pair missing, roster unsynced) heals.
  await addContactPair(deps.db, {
    userId: settled.fromUserId,
    contactUserId: settled.toUserId,
    source: 'manual',
  });
  if (deps.adminClient && deps.domain) {
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.fromUserId);
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.toUserId);
  }
  // Audited once, after the commit and the pair write, by the call that
  // actually flipped the row; an idempotent re-accept adds nothing.
  if (flippedNow) {
    auditFor(deps, 'contact_request.accepted', viewerId, settled.id);
  }
  return settled;
}

async function decideContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
  status: 'declined' | 'cancelled',
  side: 'to' | 'from',
  auditAction: string,
): Promise<ContactRequestRow> {
  const existing = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* findActionableEffect(sql, id, viewerId, side);
    }),
  );
  if (!existing || existing.status !== 'pending') {
    throw notFound();
  }
  const now = serviceNow(deps);
  const row = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [updated] = yield* sql<ContactRequestRow>`UPDATE contact_requests
        SET status = ${status}, decided_at = ${now.toISOString()}
        WHERE id = ${id} AND status = 'pending'
        RETURNING *`;
      return updated ?? null;
    }),
  );
  if (!row) {
    throw notFound();
  }
  auditFor(deps, auditAction, viewerId, row.id);
  return row;
}

// Declines a request (recipient only). A request the caller may not act on
// and an unknown id answer the same 404.
export async function declineContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'declined', 'to', 'contact_request.declined');
}

// Cancels a request (sender only). A request the caller may not act on and
// an unknown id answer the same 404.
export async function cancelContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'cancelled', 'from', 'contact_request.cancelled');
}

// The relation between the viewer and the owner of a handle, for
// `GET /api/users/by-handle/:handle`: `self`, `blocked`, `contact`,
// `request_sent`, `request_received` or `none`. `blocked` is checked first
// after `self` and means the viewer blocked the other side. Unknown and
// retired handles answer the same 404 as `resolveHandleUser`.
export async function relationFor(
  db: ServerDatabase,
  viewerId: string,
  otherId: string,
): Promise<'self' | 'blocked' | 'contact' | 'request_sent' | 'request_received' | 'none'> {
  if (viewerId === otherId) {
    return 'self';
  }
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [block] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE user_id = ${viewerId} AND blocked_user_id = ${otherId} LIMIT 1`;
      if (block) {
        return 'blocked' as const;
      }
      if (yield* isContactEffect(sql, viewerId, otherId)) {
        return 'contact' as const;
      }
      const pending = yield* pendingBetweenEffect(sql, viewerId, otherId);
      if (pending) {
        return pending.fromUserId === viewerId
          ? ('request_sent' as const)
          : ('request_received' as const);
      }
      return 'none' as const;
    }),
  );
}

export interface OtherUserProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
}

export async function profileForHandle(
  db: ServerDatabase,
  viewerId: string,
  handle: string,
): Promise<OtherUserProfile & { relation: Awaited<ReturnType<typeof relationFor>> }> {
  const lower = normalizeHandle(handle.trim());
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<{
        userId: string;
        handle: string;
        name: string;
        image: string | null;
      }>`SELECT h.user_id, h.handle, u.name, u.image
        FROM handles h
        INNER JOIN "user" u ON u.id = h.user_id
        WHERE h.handle_lower = ${lower} LIMIT 1`;
      return found ?? null;
    }),
  );
  // Reuse the row just read: an unknown handle and a retired handle answer
  // the same 404. So does a handle whose owner blocked the viewer: the
  // blocked person is never told the account exists.
  if (!row || !row.userId) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  const blockedByTarget = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [block] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE user_id = ${row.userId} AND blocked_user_id = ${viewerId} LIMIT 1`;
      return block ?? null;
    }),
  );
  if (blockedByTarget) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  return {
    userId: row.userId,
    name: row.name.trim() === '' ? 'Unnamed user' : row.name,
    handle: row.handle,
    image: row.image,
    relation: await relationFor(db, viewerId, row.userId),
  };
}
