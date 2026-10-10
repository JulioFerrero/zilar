// Handle store (T-0163): claiming and reading `@username` rows. The primary
// key on `handle_lower` is the only uniqueness rule: concurrent claims race
// on it and the loser maps to 409 `handle_taken`, never check-then-insert.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`); the exported functions stay `async` so routes and
// tests keep their shape during the transition.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { classifyHandle, normalizeHandle } from './rules';

export const HANDLE_CHANGE_INTERVAL_DAYS = 14;
export const HANDLE_RESERVATION_DAYS = 30;

export interface HandleRow {
  handleLower: string;
  handle: string;
  userId: string | null;
  groupId: string | null;
}

// The full `handles` row the claim path reads to decide.
interface HandleRecord extends HandleRow {
  createdAt: Date;
  changedAt: Date;
}

interface RetiredHandleRecord {
  handleLower: string;
  formerUserId: string | null;
  formerGroupId: string | null;
  reservedUntil: Date;
}

export async function handleForUser(db: ServerDatabase, userId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ handle: string }>`SELECT handle FROM handles
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row?.handle ?? null;
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
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [live] = yield* sql<{ handleLower: string }>`SELECT handle_lower FROM handles
        WHERE handle_lower = ${lower} LIMIT 1`;
      if (live) {
        return { available: false, reason: 'taken' as const };
      }
      const [retired] = yield* sql<{
        formerUserId: string | null;
        reservedUntil: Date;
      }>`SELECT former_user_id, reserved_until FROM retired_handles
        WHERE handle_lower = ${lower} LIMIT 1`;
      if (retired && retired.reservedUntil.getTime() > now.getTime()) {
        if (retired.formerUserId === userId) {
          return { available: true };
        }
        return { available: false, reason: 'taken' as const };
      }
      return { available: true };
    }),
  );
}

// Whether a handle is free for a public group or channel to take: same
// shape and reserved words as users (one namespace), then the live row,
// then the retired reservation (expired reads as free). A reservation held
// by the *asking group* reads as available (going public again may reuse
// it); anyone else's reservation — a user or another group — reads as
// taken. The asker passes their group id (`null` when they have no group
// yet, e.g. the create flow checks before the row exists).
export async function checkGroupHandleAvailability(
  db: ServerDatabase,
  handle: string,
  groupId: string | null = null,
  now: Date = new Date(),
): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken' }> {
  const rule = classifyHandle(handle);
  if (rule !== null) {
    return { available: false, reason: rule };
  }
  const lower = normalizeHandle(handle);
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [live] = yield* sql<{ groupId: string | null }>`SELECT group_id FROM handles
        WHERE handle_lower = ${lower} LIMIT 1`;
      if (live) {
        if (groupId !== null && live.groupId === groupId) {
          return { available: true };
        }
        return { available: false, reason: 'taken' as const };
      }
      const [retired] = yield* sql<{
        formerGroupId: string | null;
        reservedUntil: Date;
      }>`SELECT former_group_id, reserved_until FROM retired_handles
        WHERE handle_lower = ${lower} LIMIT 1`;
      if (retired && retired.reservedUntil.getTime() > now.getTime()) {
        if (groupId !== null && retired.formerGroupId === groupId) {
          return { available: true };
        }
        return { available: false, reason: 'taken' as const };
      }
      return { available: true };
    }),
  );
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

  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'handle-user:' + userId}))`;

          const [existing] = yield* sql<HandleRecord>`SELECT * FROM handles
            WHERE user_id = ${userId} LIMIT 1`;
          const lower = normalizeHandle(trimmed);
          if (existing && existing.handleLower === lower) {
            if (existing.handle !== trimmed) {
              // A casing-only change: allowed only after the interval, updates the
              // stored casing in place, retires nothing.
              const nextChangeAt = new Date(
                existing.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
              );
              if (now.getTime() < nextChangeAt.getTime()) {
                return yield* Effect.fail(
                  new HttpError(
                    409,
                    'handle_change_too_soon',
                    'You can change your username again',
                    { nextChangeAt: nextChangeAt.toISOString() },
                  ),
                );
              }
              const [updated] = yield* sql<HandleRecord>`UPDATE handles
                SET handle = ${trimmed}, changed_at = ${now}
                WHERE handle_lower = ${existing.handleLower}
                RETURNING *`;
              if (!updated) {
                return yield* Effect.fail(new Error('handle casing update returned no row'));
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
              return yield* Effect.fail(
                new HttpError(409, 'handle_change_too_soon', 'You can change your username again', {
                  nextChangeAt: nextChangeAt.toISOString(),
                }),
              );
            }
          }

          const [retired] = yield* sql<RetiredHandleRecord>`SELECT * FROM retired_handles
            WHERE handle_lower = ${lower} LIMIT 1`;
          if (retired) {
            const reserved = retired.reservedUntil.getTime() > now.getTime();
            if (reserved && retired.formerUserId !== userId) {
              return yield* Effect.fail(
                new HttpError(409, 'handle_taken', 'That username is taken'),
              );
            }
            yield* sql`DELETE FROM retired_handles WHERE handle_lower = ${lower}`;
          }

          if (existing) {
            yield* sql`DELETE FROM handles WHERE handle_lower = ${existing.handleLower}`;
            // The reservation belongs to whoever just gave the handle up: upsert
            // so a racing retire (older owner) cannot survive a newer one. In
            // practice the older reservation cannot exist here — the winner holds
            // the live row, so only the winner reaches this path — but the upsert
            // makes that invariant hold even if two txs interleave.
            const reservedUntil = new Date(
              now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000,
            );
            yield* sql`INSERT INTO retired_handles
                (handle_lower, former_user_id, former_group_id, reserved_until)
              VALUES (${existing.handleLower}, ${userId}, ${null}, ${reservedUntil})
              ON CONFLICT (handle_lower) DO UPDATE SET
                former_user_id = EXCLUDED.former_user_id,
                former_group_id = EXCLUDED.former_group_id,
                reserved_until = EXCLUDED.reserved_until`;
          }

          const [row] = yield* sql<HandleRecord>`INSERT INTO handles
              (handle_lower, handle, user_id, group_id, created_at, changed_at)
            VALUES (${lower}, ${trimmed}, ${userId}, ${null}, ${now}, ${now})
            RETURNING *`.pipe(
            Effect.catchIf(
              (error) => isUniqueViolation(error),
              () => Effect.fail(new HttpError(409, 'handle_taken', 'That username is taken')),
            ),
          );
          if (!row) {
            return yield* Effect.fail(new Error('handle insert returned no row'));
          }
          return { handle: row.handle };
        }),
      );
    }),
  );
}

// Whether `error` is a unique-constraint violation: either the structured
// `effect/sql` `UniqueViolation` reason or a driver error carrying the
// Postgres `23505` code. Driver failures can be wrapped, so the code may sit on
// a nested `cause` (`groups/service.ts` calls this on its `effect/sql` insert).
// Walk the chain; the message check is a last-resort fallback
// for the wrapped shape only, never matched instead of a code.
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    return error.reason._tag === 'UniqueViolation';
  }
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
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM retired_handles WHERE reserved_until <= ${now}`;
      }),
    );
  } catch {
    // Best effort only.
  }
}
