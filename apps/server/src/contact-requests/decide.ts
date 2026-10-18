import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { removePairRosterItems } from '../blocks/roster';
import { pairHasBlock } from '../blocks/service';
import { addContactPairEffect, syncRoster } from '../contacts/service';
import { runSql } from '../effect/sql';
import { notFound } from './errors';
import {
  auditFor,
  findActionableEffect,
  serviceNow,
  type ContactRequestRow,
  type ContactRequestsDeps,
} from './queries';

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
