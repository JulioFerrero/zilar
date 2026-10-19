import type { ServerCore } from '../app/deps';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  ContactRequestByHandleRateLimit,
  ContactRequestCreateRateLimit,
  ContactRequestReadRateLimit,
  ContactRequestsGroup,
  ContactRequestsSchemaErrors,
  UserSearchRateLimit,
} from '@zilar/api-contract';

import { type AuditRecorder } from '../audit/recorder';
import { removePairRosterItems } from '../blocks/roster';
import { pairHasBlock } from '../blocks/service';
import { addContactPairEffect, syncRoster } from '../contacts/service';

import { type ServerDatabase } from '../db/client';
import { limiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import {
  mountGroups,
  handler,
  schemaErrorLayerFor,
  type EffectApiMount,
} from '../effect/http-core';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { normalizeHandle } from '@zilar/protocol';
import { isPendingPairViolation, notFound } from './errors';
import {
  auditFor,
  findActionableEffect,
  isContactEffect,
  MAX_PENDING_OUTGOING,
  pendingBetweenEffect,
  RE_REQUEST_COOLDOWN_DAYS,
  resolveHandleUser,
  serviceNow,
  type ContactRequestRow,
  type ContactRequestsDeps,
} from './queries';
import {
  listContactRequests,
  profileForHandle,
  relationFor,
  relationsFor,
  type OtherUserProfile,
} from './reads';
const USER_SEARCH_MIN_LENGTH = 3;
const USER_SEARCH_LIMIT = 10;

type HandleRelation = Awaited<ReturnType<typeof relationFor>>;

type UserSearchEntry = OtherUserProfile & { relation: HandleRelation };

// `%`, `_` and the escape char are literal text; PostgreSQL `LIKE` treats
// backslash as the escape by default, so no `ESCAPE` clause is needed.
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeUserSearchQuery(query: string): string {
  const trimmed = query.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return normalizeHandle(withoutAt);
}

export async function searchUsers(
  db: ServerDatabase,
  viewerId: string,
  query: string,
): Promise<UserSearchEntry[]> {
  const q = normalizeUserSearchQuery(query);
  if (q.length < USER_SEARCH_MIN_LENGTH) {
    return [];
  }
  const pattern = escapeLike(q);
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Exact handle or handle prefix only, never a display name, which would let
      // the whole user base be enumerated. The viewer and a blocker are excluded.
      return yield* sql<{
        userId: string;
        handle: string;
        name: string;
        image: string | null;
      }>`SELECT h.user_id, h.handle, u.name, u.image
        FROM handles h
        INNER JOIN "user" u ON u.id = h.user_id
        WHERE u.id <> ${viewerId}
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE b.user_id = u.id AND b.blocked_user_id = ${viewerId}
          )
          AND h.handle_lower LIKE ${pattern + '%'}
        ORDER BY
          CASE WHEN h.handle_lower = ${q} THEN 0 ELSE 1 END,
          u.name
        LIMIT ${USER_SEARCH_LIMIT}`;
    }),
  );
  // One batched read for every row's relation instead of a round trip per row.
  const relations = await relationsFor(
    db,
    viewerId,
    rows.map((row) => row.userId),
  );
  const entries: UserSearchEntry[] = rows.map((row) => ({
    userId: row.userId,
    name: row.name.trim() === '' ? 'Unnamed user' : row.name,
    handle: row.handle,
    image: row.image,
    relation: relations.get(row.userId) ?? 'none',
  }));
  return entries;
}

const RATE_LIMITED_MESSAGE = 'Too many attempts, try again later';

const ContactRequestsApi = HttpApi.make('contactRequests').add(ContactRequestsGroup);

export interface ContactRequestsApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'adminClient' | 'logger'
> {
  audit?: AuditRecorder;
  now?: () => number;
  createLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
  byHandleLimiter?: RateLimiter;
  userSearchLimiter?: RateLimiter;
}

function toJson(row: ContactRequestRow) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}

export function createContactRequestsApi(deps: ContactRequestsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const db = deps.db;
  const logger = deps.logger;
  const createLimiter = deps.createLimiter ?? limiter('contactRequestCreate', now);
  const readLimiter = deps.readLimiter ?? limiter('contactRequestRead', now);
  const byHandleLimiter = deps.byHandleLimiter ?? limiter('byHandle', now);
  const userSearchLimiter = deps.userSearchLimiter ?? limiter('userSearch', now);

  function service(): ContactRequestsDeps {
    return {
      db,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
    };
  }

  const groupLayer = HttpApiBuilder.group(ContactRequestsApi, 'contactRequests', (handlers) =>
    handlers
      // Unknown handles answer the same 404 as retired ones. A reverse pending
      // request answers 200 with `incoming: true`, so the web can offer "Accept".
      .handle(
        'create',
        handler(logger, async (request, user) => {
          const { request: created, reverseOf } = await createContactRequest(
            service(),
            user.id,
            request.payload.handle,
          );
          if (reverseOf) {
            return { request: toJson(reverseOf), incoming: true as const };
          }
          return { request: toJson(created) };
        }),
      )
      .handle(
        'list',
        handler(logger, (_request, user) => listContactRequests(service(), user.id)),
      )
      // Accepts a request (recipient only). Idempotent and repairing.
      .handle(
        'accept',
        handler(logger, async (request, user) => ({
          request: toJson(await acceptContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Recipient only; not-actable and unknown ids answer the same 404.
      .handle(
        'decline',
        handler(logger, async (request, user) => ({
          request: toJson(await declineContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Sender only; not-actable and unknown ids answer the same 404.
      .handle(
        'cancel',
        handler(logger, async (request, user) => ({
          request: toJson(await cancelContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Exact, case-insensitive handle lookup. Unknown and retired handles answer
      // the same 404. Never an email.
      .handle(
        'byHandle',
        handler(logger, (request, user) => profileForHandle(db, user.id, request.params.handle)),
      )
      // Prefix search by `@username` only, up to 10 people. The query is never
      // logged.
      .handle(
        'search',
        handler(logger, async (request, user) => ({
          entries: await searchUsers(db, user.id, request.query.q),
        })),
      ),
  );

  // The create budget runs before the payload is decoded, so an invalid body
  // still spends it. The read budget covers list, accept, decline and cancel.
  return mountGroups(ContactRequestsApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: schemaErrorLayerFor(
      ContactRequestsSchemaErrors,
      logger,
      'handle must be a string of 1 to 64 characters, with no other keys',
    ),
    afterSchema: [
      rateLimitLayer(ContactRequestCreateRateLimit, createLimiter, RATE_LIMITED_MESSAGE),
      rateLimitLayer(ContactRequestReadRateLimit, readLimiter, RATE_LIMITED_MESSAGE),
      rateLimitLayer(ContactRequestByHandleRateLimit, byHandleLimiter, RATE_LIMITED_MESSAGE),
      rateLimitLayer(UserSearchRateLimit, userSearchLimiter, RATE_LIMITED_MESSAGE),
    ],
  });
}
// Adding by `@username` sends a request the other person must accept. An unknown
// handle, a retired one and a not-allowed request answer the same 404.

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
// Recipient only. The status flip runs under a per-request advisory lock, so a
// double click flips once. The pair creation and roster sync follow outside the
// transaction but are idempotent, so a re-accept repairs a half-finished one.
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
              // A concurrent decision won: re-read so an accepted row still answers
              // idempotently instead of 404ing.
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

  // While either side blocks the other the pair stays gone, even for a legacy
  // accepted row. The block read and pair insert share one transaction under both
  // sides' `user-block:` locks, the keys `blockUser` takes.
  const [lockLow, lockHigh] = [settled.fromUserId, settled.toUserId].sort();
  const repaired = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          // Sorted keys, so two accepts of opposite-direction requests take the
          // locks in the same order and cannot deadlock.
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + lockLow}))`;
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + lockHigh}))`;
          const [block] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
            WHERE (user_id = ${settled.fromUserId} AND blocked_user_id = ${settled.toUserId})
               OR (user_id = ${settled.toUserId} AND blocked_user_id = ${settled.fromUserId})
            LIMIT 1`;
          if (block !== undefined) {
            return false;
          }
          // A removal cancels the row and deletes the pair under these same locks.
          // Re-read inside the lock so the repair does not re-add the pair.
          const [current] = yield* sql<{ status: string }>`SELECT status FROM contact_requests
            WHERE id = ${settled.id} LIMIT 1`;
          if (current?.status !== 'accepted') {
            return false;
          }
          yield* addContactPairEffect(sql, {
            userId: settled.fromUserId,
            contactUserId: settled.toUserId,
            source: 'manual',
          });
          return true;
        }),
      );
    }),
  );
  if (repaired && deps.adminClient && deps.domain) {
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.fromUserId);
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.toUserId);
  }
  // A block can commit between the pair insert and the roster sync, after the
  // sync read the pair. Re-check after every write and undo both, so a blocked
  // pair cannot keep the `both` subscription; a later block cleans up itself.
  if (repaired && (await pairHasBlock(deps.db, settled.fromUserId, settled.toUserId))) {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM contacts
          WHERE (user_id = ${settled.fromUserId} AND contact_user_id = ${settled.toUserId})
             OR (user_id = ${settled.toUserId} AND contact_user_id = ${settled.fromUserId})`;
      }),
    );
    if (deps.adminClient && deps.domain) {
      await removePairRosterItems({
        db: deps.db,
        adminClient: deps.adminClient,
        domain: deps.domain,
        userId: settled.fromUserId,
        targetId: settled.toUserId,
      });
    }
  }
  // Audited once, by the call that actually flipped the row; a re-accept adds
  // nothing.
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

// Recipient only; not-actable and unknown ids answer the same 404.
export async function declineContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'declined', 'to', 'contact_request.declined');
}

export async function cancelContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'cancelled', 'from', 'contact_request.cancelled');
}
