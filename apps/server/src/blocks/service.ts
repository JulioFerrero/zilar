// A silent blocklist: blocking never tells the blocked person — their requests look
// successful and handle lookups answer 404. Callers already hold a session; the routes
// own the rate limit.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { removePairRosterItems, type RosterLogger } from './roster';

// The list endpoint caps server-side so the response stays bounded.
export const MAX_BLOCK_LIST_ROWS = 500;

export interface BlocksDeps {
  db: ServerDatabase;
  audit?: AuditRecorder;
  now?: () => Date;
  adminClient?: EjabberdAdminClient | undefined;
  domain?: string | undefined;
  logger?: RosterLogger | undefined;
}

export interface BlockedUserView {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
  jid: string | null;
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

// A DM peer JID maps through `xmpp_accounts.jid`; an AI has no row, so no block.
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

// The group joins use this: a blocked person cannot join the owner's public group or
// invite link, and vice versa, in either direction.
export async function pairHasBlock(
  db: ServerDatabase,
  userId: string,
  otherId: string,
): Promise<boolean> {
  const [block] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE (user_id = ${userId} AND blocked_user_id = ${otherId})
           OR (user_id = ${otherId} AND blocked_user_id = ${userId})
        LIMIT 1`;
    }),
  );
  return block !== undefined;
}

// Idempotent; unknown users answer 404, yourself 400. Every pending or accepted contact
// request between the pair is cancelled and both `contacts` rows deleted in the same
// transaction, serialized against contact-request creates by the advisory locks below.
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
        // A request A→B could otherwise commit after this block cancels the pending rows:
        // take the blocked person's sender key BEFORE the cancel update. The sender key
        // comes first, then `user-block:`, in every transaction that needs the pair, so no
        // lock order exists to deadlock. PGlite has one connection, so the two takes are
        // sequential and never held while waiting on another.
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
        // Accepted rows go too: leaving one alive let a re-accept repair the pair back.
        yield* sql`UPDATE contact_requests
          SET status = 'cancelled', decided_at = ${now.toISOString()}
          WHERE status IN ('pending', 'accepted')
            AND ((from_user_id = ${userId} AND to_user_id = ${targetId})
              OR (from_user_id = ${targetId} AND to_user_id = ${userId}))`;
        // The pair is gone in both directions even when the block row existed: an accepted
        // contact between blocks must not survive a re-block.
        yield* sql`DELETE FROM contacts
          WHERE (user_id = ${userId} AND contact_user_id = ${targetId})
            OR (user_id = ${targetId} AND contact_user_id = ${userId})`;
        return rows.length > 0;
      }),
    );
  });
  const inserted = await runSql(deps.db, insert);
  // Audited after the commit by the call that inserted the row; ids only, never names.
  if (inserted) {
    auditFor(deps, 'user.blocked', userId, targetId);
  }
  // Best effort after the commit: the pair's `both` subscriptions would keep the blocked
  // person seeing the blocker online.
  if (deps.adminClient !== undefined && deps.domain !== undefined) {
    await removePairRosterItems({
      db: deps.db,
      adminClient: deps.adminClient,
      domain: deps.domain,
      logger: deps.logger,
      userId,
      targetId,
    });
  }
  return { blocked: true };
}

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

// The blocker's list, newest first, capped. Never an email; one joined query over the
// blocked ids, never one select per row.
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
