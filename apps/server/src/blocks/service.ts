// User blocks (T-0171, part 1a): a silent blocklist. Blocking never tells
// the blocked person: their requests look successful and handle lookups
// answer 404. Reads and writes here assume the caller already holds a
// session; the routes own the rate limit.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';

// The list endpoint caps server-side; nobody should keep 500 blocks, but
// the cap keeps the response bounded.
export const MAX_BLOCK_LIST_ROWS = 500;

export interface BlocksDeps {
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Override the clock in tests. Defaults to the wall clock. */
  now?: () => Date;
}

export interface BlockedUserView {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
  jid: string | null;
}

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

function serviceNow(deps: BlocksDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function auditFor(deps: BlocksDeps, action: string, actorUserId: string, subjectId: string): void {
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

// A DM peer JID maps to one of our users through `xmpp_accounts.jid`. An AI
// peer has no row (and therefore no block). The lookup folds case like
// `resolveChatFilter`.
export async function isDmBlocked(
  db: ServerDatabase,
  userId: string,
  peerJid: string,
): Promise<boolean> {
  const [peer] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM xmpp_accounts
        WHERE lower(jid) = ${peerJid.toLowerCase()} LIMIT 1`;
    }),
  );
  if (peer === undefined) {
    return false;
  }
  // Either direction hides the DM: a block is silent.
  const [block] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE (user_id = ${userId} AND blocked_user_id = ${peer.userId})
           OR (user_id = ${peer.userId} AND blocked_user_id = ${userId})
        LIMIT 1`;
    }),
  );
  return block !== undefined;
}

// Blocks `targetId` for `userId`. Idempotent: blocking twice keeps one row.
// Unknown users answer 404, yourself answers 400. Every pending contact
// request between the two (either direction) becomes `cancelled` in the
// same transaction, serialized against contact-request creates through the
// advisory locks taken below.
export async function blockUser(
  deps: BlocksDeps,
  userId: string,
  targetId: string,
): Promise<{ blocked: true }> {
  if (userId === targetId) {
    throw new HttpError(400, 'invalid_request', 'You cannot block yourself');
  }
  const now = serviceNow(deps);
  const insert = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        // A request A→B can otherwise commit after this block cancels the
        // pending rows: `createContactRequest` serializes on
        // `contact-sender:<sender>`, so this transaction takes the blocked
        // person's sender key too, BEFORE the cancel update. The sender key
        // comes first, then `user-block:`, in both transactions that need the
        // pair — `createContactRequest` only ever takes the sender key — so no
        // lock order exists to deadlock. (PGlite has one connection per
        // database, which is why the handle-comment rule in
        // `createContactRequest` folds keys into one critical section; here the
        // two takes are sequential on the same connection, never held while
        // waiting on another.)
        yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-sender:' + targetId}))`;
        yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + userId}))`;
        const [target] = yield* sql<{ id: string }>`SELECT id FROM "user"
          WHERE id = ${targetId} LIMIT 1`;
        if (target === undefined) {
          return yield* Effect.fail(new HttpError(404, 'not_found', 'User not found'));
        }
        const rows = yield* sql<{ userId: string }>`INSERT INTO user_blocks
            (user_id, blocked_user_id, created_at)
          VALUES (${userId}, ${targetId}, ${now.toISOString()})
          ON CONFLICT DO NOTHING
          RETURNING user_id`;
        yield* sql`UPDATE contact_requests
          SET status = 'cancelled', decided_at = ${now.toISOString()}
          WHERE status = 'pending'
            AND ((from_user_id = ${userId} AND to_user_id = ${targetId})
              OR (from_user_id = ${targetId} AND to_user_id = ${userId}))`;
        return rows.length > 0;
      }),
    );
  });
  const inserted = await sqlRuntimeFor(deps.db).runPromise(insert);
  // Audited once, after the commit, by the call that actually inserted the
  // row; an idempotent re-block adds nothing. Ids only, never names.
  if (inserted) {
    auditFor(deps, 'user.blocked', userId, targetId);
  }
  return { blocked: true };
}

// Unblocks `targetId` for `userId`. Idempotent: unblocking twice (or
// unblocking someone never blocked, unknown or not) still answers success
// and deletes only the row `(userId, targetId)`.
export async function unblockUser(
  deps: BlocksDeps,
  userId: string,
  targetId: string,
): Promise<{ blocked: false }> {
  const [deleted] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`DELETE FROM user_blocks
        WHERE user_id = ${userId} AND blocked_user_id = ${targetId}
        RETURNING user_id`;
    }),
  );
  if (deleted) {
    auditFor(deps, 'user.unblocked', userId, targetId);
  }
  return { blocked: false };
}

// The blocker's list, newest first, capped server-side: `{ userId, name,
// handle, image, jid }`. Never an email; `handle` is null when the person
// has none and `jid` is null when they have no XMPP account. One joined
// query over the blocked ids — never one select per row.
export async function listBlockedUsers(
  deps: BlocksDeps,
  userId: string,
): Promise<{ blocked: BlockedUserView[] }> {
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BlockedUserView>`SELECT u.id AS user_id, u.name, u.image,
          h.handle, x.jid
        FROM user_blocks b
        INNER JOIN "user" u ON u.id = b.blocked_user_id
        LEFT JOIN handles h ON h.user_id = u.id
        LEFT JOIN xmpp_accounts x ON x.user_id = u.id
        WHERE b.user_id = ${userId}
        ORDER BY b.created_at DESC
        LIMIT ${MAX_BLOCK_LIST_ROWS}`;
    }),
  );
  return {
    blocked: rows.map((row) => ({
      userId: row.userId,
      name: row.name.trim() === '' ? 'Unnamed user' : row.name,
      handle: row.handle,
      image: row.image,
      jid: row.jid,
    })),
  };
}
