// User blocks (T-0171, part 1a): a silent blocklist. Blocking never tells
// the blocked person: their requests look successful and handle lookups
// answer 404. Reads and writes here assume the caller already holds a
// session; the routes own the rate limit.

import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { contactRequests, handles, user, userBlocks } from '../db/schema';
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
  const inserted = await deps.db.transaction(async (tx) => {
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
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-sender:' + targetId}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + userId}))`);
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, targetId))
      .limit(1);
    if (!target) {
      throw new HttpError(404, 'not_found', 'User not found');
    }
    const [row] = await tx
      .insert(userBlocks)
      .values({ userId, blockedUserId: targetId, createdAt: now })
      .onConflictDoNothing()
      .returning();
    await tx
      .update(contactRequests)
      .set({ status: 'cancelled', decidedAt: now })
      .where(
        and(
          eq(contactRequests.status, 'pending'),
          or(
            and(eq(contactRequests.fromUserId, userId), eq(contactRequests.toUserId, targetId)),
            and(eq(contactRequests.fromUserId, targetId), eq(contactRequests.toUserId, userId)),
          ),
        ),
      );
    return row !== undefined;
  });
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
  const [deleted] = await deps.db
    .delete(userBlocks)
    .where(and(eq(userBlocks.userId, userId), eq(userBlocks.blockedUserId, targetId)))
    .returning();
  if (deleted) {
    auditFor(deps, 'user.unblocked', userId, targetId);
  }
  return { blocked: false };
}

// The blocker's list, newest first, capped server-side: `{ userId, name,
// handle, image }`. Never an email; `handle` is null when the person has
// none. One joined query over the blocked ids — never one select per row.
export async function listBlockedUsers(
  deps: BlocksDeps,
  userId: string,
): Promise<{ blocked: BlockedUserView[] }> {
  const rows = await deps.db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      handle: handles.handle,
    })
    .from(userBlocks)
    .innerJoin(user, eq(user.id, userBlocks.blockedUserId))
    .leftJoin(handles, eq(handles.userId, user.id))
    .where(eq(userBlocks.userId, userId))
    .orderBy(desc(userBlocks.createdAt))
    .limit(MAX_BLOCK_LIST_ROWS);
  return {
    blocked: rows.map((row) => ({
      userId: row.userId,
      name: row.name.trim() === '' ? 'Unnamed user' : row.name,
      handle: row.handle,
      image: row.image,
    })),
  };
}
