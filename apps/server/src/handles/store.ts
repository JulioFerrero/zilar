// Handle store (T-0163): claiming and reading `@username` rows. The primary
// key on `handle_lower` is the only uniqueness rule: concurrent claims race
// on it and the loser maps to 409 `handle_taken`, never check-then-insert.

import { eq, inArray, lte, sql } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { handles, retiredHandles, user } from '../db/schema';
import { HttpError } from '../errors';
import type { SetupTransaction } from '../setup/settings';
import { classifyHandle, normalizeHandle } from './rules';

export const HANDLE_CHANGE_INTERVAL_DAYS = 14;
export const HANDLE_RESERVATION_DAYS = 30;

export interface HandleRow {
  handleLower: string;
  handle: string;
  userId: string | null;
  groupId: string | null;
}

export async function findHandle(db: ServerDatabase, handle: string): Promise<HandleRow | null> {
  const [row] = await db
    .select()
    .from(handles)
    .where(eq(handles.handleLower, normalizeHandle(handle)))
    .limit(1);
  return row ?? null;
}

export async function handleForUser(db: ServerDatabase, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(eq(handles.userId, userId))
    .limit(1);
  return row?.handle ?? null;
}

export async function handleUserIdFor(
  db: ServerDatabase,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ userId: handles.userId, handle: handles.handle })
    .from(handles)
    .where(inArray(handles.userId, [...new Set(userIds)]));
  const byUser = new Map<string, string>();
  for (const row of rows) {
    if (row.userId !== null) {
      byUser.set(row.userId, row.handle);
    }
  }
  return byUser;
}

// Whether a handle is free for `userId` to take: shape and reserved words
// first, then the live row, then the retired reservation (expired reads as
// free; a reservation held by the asker reads as free). `reason` is set
// exactly when the handle is not available.
export async function checkHandleAvailability(
  db: ServerDatabase,
  userId: string,
  handle: string,
  now: Date = new Date(),
): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken' }> {
  const rule = classifyHandle(handle);
  if (rule !== null) {
    return { available: false, reason: rule };
  }
  const lower = normalizeHandle(handle);
  const [live] = await db.select().from(handles).where(eq(handles.handleLower, lower)).limit(1);
  if (live) {
    return { available: false, reason: 'taken' };
  }
  const [retired] = await db
    .select()
    .from(retiredHandles)
    .where(eq(retiredHandles.handleLower, lower))
    .limit(1);
  if (retired && retired.reservedUntil.getTime() > now.getTime()) {
    if (retired.formerUserId === userId) {
      return { available: true };
    }
    return { available: false, reason: 'taken' };
  }
  return { available: true };
}

// Claims `handle` for `userId`: the first claim is always allowed, later
// ones only 14 days after the previous change. Saving the same handle
// (case-insensitively) returns the existing row before the interval check:
// it is a no-op (no budget, no retirement); a casing-only change is applied
// and updates the stored casing, but still obeys the 14-day interval and
// never retires the handle. Any other change retires the old handle for 30
// days (reclaimable by its former owner only) and writes the new row last,
// so its unique violation (the race backstop) maps to 409 `handle_taken`.
// Everything runs in one transaction under a per-user advisory lock, and
// every row the decision depends on is read INSIDE it. Throws `HttpError`
// with `handle_invalid`, `handle_reserved`, `handle_taken` or
// `handle_change_too_soon` (with `nextChangeAt` in the error detail and the
// 409 JSON body).
export async function claimHandle(
  db: ServerDatabase,
  userId: string,
  handle: string,
  now: Date = new Date(),
): Promise<{ handle: string }> {
  const trimmed = handle.trim();
  const rule = classifyHandle(trimmed);
  if (rule === 'invalid') {
    throw new HttpError(400, 'handle_invalid', 'That username is not valid');
  }
  if (rule === 'reserved') {
    throw new HttpError(409, 'handle_reserved', 'That username is reserved');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'handle-user:' + userId}))`);

    const [existing] = await tx.select().from(handles).where(eq(handles.userId, userId)).limit(1);
    const lower = normalizeHandle(trimmed);
    if (existing && existing.handleLower === lower) {
      if (existing.handle !== trimmed) {
        // A casing-only change: allowed only after the interval, updates the
        // stored casing in place, retires nothing.
        const nextChangeAt = new Date(
          existing.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
        );
        if (now.getTime() < nextChangeAt.getTime()) {
          throw new HttpError(409, 'handle_change_too_soon', 'You can change your username again', {
            nextChangeAt: nextChangeAt.toISOString(),
          });
        }
        const [updated] = await tx
          .update(handles)
          .set({ handle: trimmed, changedAt: now })
          .where(eq(handles.handleLower, existing.handleLower))
          .returning();
        if (!updated) {
          throw new Error('handle casing update returned no row');
        }
        return { handle: updated.handle };
      }
      return { handle: existing.handle };
    }
    if (existing) {
      const nextChangeAt = new Date(
        existing.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
      );
      if (now.getTime() < nextChangeAt.getTime()) {
        throw new HttpError(409, 'handle_change_too_soon', 'You can change your username again', {
          nextChangeAt: nextChangeAt.toISOString(),
        });
      }
    }

    const [retired] = await tx
      .select()
      .from(retiredHandles)
      .where(eq(retiredHandles.handleLower, lower))
      .limit(1);
    if (retired) {
      const reserved = retired.reservedUntil.getTime() > now.getTime();
      if (reserved && retired.formerUserId !== userId) {
        throw new HttpError(409, 'handle_taken', 'That username is taken');
      }
      await tx.delete(retiredHandles).where(eq(retiredHandles.handleLower, lower));
    }

    if (existing) {
      await tx.delete(handles).where(eq(handles.handleLower, existing.handleLower));
      await tx
        .insert(retiredHandles)
        .values({
          handleLower: existing.handleLower,
          formerUserId: userId,
          formerGroupId: null,
          reservedUntil: new Date(now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();
    }

    try {
      const [row] = await tx
        .insert(handles)
        .values({
          handleLower: lower,
          handle: trimmed,
          userId,
          groupId: null,
          createdAt: now,
          changedAt: now,
        })
        .returning();
      if (!row) {
        throw new Error('handle insert returned no row');
      }
      return { handle: row.handle };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, 'handle_taken', 'That username is taken');
      }
      throw error;
    }
  });
}

// Drizzle wraps driver failures, so the unique code (23505 on Postgres and
// PGlite) lives on a nested `cause`. Walk the chain.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    if (
      typeof record.message === 'string' &&
      (/duplicate key/i.test(record.message) || /UNIQUE constraint/i.test(record.message))
    ) {
      return true;
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}

// Reaps expired retired rows opportunistically after a claim, so the table
// does not grow forever. Best effort: a failure never fails the claim.
export async function reapExpiredRetiredHandles(
  db: ServerDatabase,
  now: Date = new Date(),
): Promise<void> {
  try {
    await db.delete(retiredHandles).where(lte(retiredHandles.reservedUntil, now));
  } catch {
    // Best effort only.
  }
}

export async function displayNameFor(
  db: ServerDatabase,
  userId: string,
): Promise<{ name: string; image: string | null }> {
  const [row] = await db
    .select({ name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return { name: row?.name ?? '', image: row?.image ?? null };
}

export type Queryable = ServerDatabase | SetupTransaction;

export async function queryHandleForUser(db: Queryable, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(eq(handles.userId, userId))
    .limit(1);
  return row?.handle ?? null;
}

export function isHandleChangeTooSoon(error: unknown): error is HttpError {
  return error instanceof HttpError && error.code === 'handle_change_too_soon';
}
