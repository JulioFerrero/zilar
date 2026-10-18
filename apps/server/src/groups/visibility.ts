import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import {
  HANDLE_CHANGE_INTERVAL_DAYS,
  HANDLE_RESERVATION_DAYS,
  isUniqueViolation,
} from '../handles/store';
import { classifyHandle, normalizeHandle } from '../handles/rules';

export type GroupVisibility = 'private' | 'public';

export interface SetGroupVisibilityInput {
  groupId: string;
  actorId: string;
  visibility: GroupVisibility;
  /** Required when going public; forbidden when going private. */
  handle?: string | undefined;
  now?: Date;
}

export interface SetGroupVisibilityResult {
  visibility: GroupVisibility;
  /** The handle for a public group (null when going private). */
  handle: string | null;
}

interface LiveHandleRow {
  handleLower: string;
  handle: string;
  changedAt: Date;
}

interface RetiredHandleRow {
  formerGroupId: string | null;
  reservedUntil: Date;
}

// Makes a group public (with a handle) or private, in one transaction under
// a per-group advisory lock, so the handle rows the decision depends on are
// read INSIDE the transaction (never check-then-insert). Only the owner may
// change visibility; a non-owner and a stranger see the same 404 as a
// missing group. A public group needs a valid, unique handle
// (`handle_invalid`, `handle_reserved`, `handle_taken`): the first claim is
// always allowed and a retired reservation belongs to its group. A
// casing-only change obeys the 14-day interval and updates the casing;
// public to private retires the handle for 30 days, so the directory drops
// the group at once. Audit entries are written by the route after the
// commit, ids only.
export async function setGroupVisibility(
  db: ServerDatabase,
  input: SetGroupVisibilityInput,
): Promise<SetGroupVisibilityResult> {
  const now = input.now ?? new Date();
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-visibility:' + input.groupId}))`;

          const [group] = yield* sql<{
            id: string;
            visibility: GroupVisibility;
          }>`SELECT id, visibility FROM groups
            WHERE id = ${input.groupId} LIMIT 1`;
          let membership: { role: string } | undefined;
          if (group) {
            [membership] = yield* sql<{ role: string }>`SELECT role FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
          }
          // A non-member sees the same 404 as a missing group; only the owner may
          // touch visibility.
          if (!group || !membership || membership.role !== 'owner') {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Group not found'));
          }

          const [live] =
            yield* sql<LiveHandleRow>`SELECT handle_lower, handle, changed_at FROM handles
            WHERE group_id = ${input.groupId} LIMIT 1`;
          const currentVisibility: GroupVisibility = group.visibility;

          if (input.visibility === 'private') {
            if (input.handle !== undefined) {
              return yield* Effect.fail(
                new HttpError(400, 'invalid_request', 'A private group has no handle'),
              );
            }
            if (live) {
              yield* sql`DELETE FROM handles WHERE handle_lower = ${live.handleLower}`;
              const reservedUntil = new Date(
                now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000,
              );
              yield* sql`INSERT INTO retired_handles
                  (handle_lower, former_user_id, former_group_id, reserved_until)
                VALUES (${live.handleLower}, ${null}, ${input.groupId}, ${reservedUntil})
                ON CONFLICT (handle_lower) DO UPDATE SET
                  former_user_id = EXCLUDED.former_user_id,
                  former_group_id = EXCLUDED.former_group_id,
                  reserved_until = EXCLUDED.reserved_until`;
            }
            if (currentVisibility !== 'private') {
              yield* sql`UPDATE groups SET visibility = 'private' WHERE id = ${input.groupId}`;
            }
            return { visibility: 'private' as const, handle: null };
          }

          const trimmed = (input.handle ?? '').trim();
          if (trimmed === '') {
            return yield* Effect.fail(
              new HttpError(400, 'invalid_request', 'A public group needs a handle'),
            );
          }
          const rule = classifyHandle(trimmed);
          if (rule === 'invalid') {
            return yield* Effect.fail(
              new HttpError(400, 'handle_invalid', 'That handle is not valid'),
            );
          }
          if (rule === 'reserved') {
            return yield* Effect.fail(
              new HttpError(409, 'handle_reserved', 'That handle is reserved'),
            );
          }
          const lower = normalizeHandle(trimmed);

          if (live && live.handleLower === lower) {
            if (live.handle !== trimmed) {
              const nextChangeAt = new Date(
                live.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
              );
              if (now.getTime() < nextChangeAt.getTime()) {
                return yield* Effect.fail(
                  new HttpError(409, 'handle_change_too_soon', 'You can change it again', {
                    nextChangeAt: nextChangeAt.toISOString(),
                  }),
                );
              }
              yield* sql`UPDATE handles SET handle = ${trimmed}, changed_at = ${now}
                WHERE handle_lower = ${live.handleLower}`;
            }
            if (currentVisibility !== 'public') {
              yield* sql`UPDATE groups SET visibility = 'public' WHERE id = ${input.groupId}`;
            }
            return { visibility: 'public' as const, handle: trimmed };
          }

          if (live) {
            const nextChangeAt = new Date(
              live.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
            );
            if (now.getTime() < nextChangeAt.getTime()) {
              return yield* Effect.fail(
                new HttpError(409, 'handle_change_too_soon', 'You can change it again', {
                  nextChangeAt: nextChangeAt.toISOString(),
                }),
              );
            }
          }

          // A live row owned by someone else is taken; a retired reservation belongs
          // to its former owner only, and an expired one reads as free. The insert
          // races on the primary key, so exactly one wins and a violation maps to 409
          // `handle_taken`.
          const [taken] = yield* sql<{ handleLower: string }>`SELECT handle_lower FROM handles
            WHERE handle_lower = ${lower} LIMIT 1`;
          if (taken) {
            return yield* Effect.fail(new HttpError(409, 'handle_taken', 'That handle is taken'));
          }
          const [retired] =
            yield* sql<RetiredHandleRow>`SELECT former_group_id, reserved_until FROM retired_handles
            WHERE handle_lower = ${lower} LIMIT 1`;
          if (retired) {
            const reserved = retired.reservedUntil.getTime() > now.getTime();
            if (reserved && retired.formerGroupId !== input.groupId) {
              return yield* Effect.fail(new HttpError(409, 'handle_taken', 'That handle is taken'));
            }
            yield* sql`DELETE FROM retired_handles WHERE handle_lower = ${lower}`;
          }

          if (live) {
            yield* sql`DELETE FROM handles WHERE handle_lower = ${live.handleLower}`;
            const reservedUntil = new Date(
              now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000,
            );
            yield* sql`INSERT INTO retired_handles
                (handle_lower, former_user_id, former_group_id, reserved_until)
              VALUES (${live.handleLower}, ${null}, ${input.groupId}, ${reservedUntil})
              ON CONFLICT (handle_lower) DO UPDATE SET
                former_user_id = EXCLUDED.former_user_id,
                former_group_id = EXCLUDED.former_group_id,
                reserved_until = EXCLUDED.reserved_until`;
          }

          const [row] = yield* sql<{ handleLower: string }>`INSERT INTO handles
              (handle_lower, handle, user_id, group_id, created_at, changed_at)
            VALUES (${lower}, ${trimmed}, ${null}, ${input.groupId}, ${now}, ${now})
            RETURNING handle_lower`.pipe(
            Effect.catchIf(
              (error) => isUniqueViolation(error),
              () => Effect.fail(new HttpError(409, 'handle_taken', 'That handle is taken')),
            ),
          );
          if (!row) {
            return yield* Effect.fail(new Error('group handle insert returned no row'));
          }
          if (currentVisibility !== 'public') {
            yield* sql`UPDATE groups SET visibility = 'public' WHERE id = ${input.groupId}`;
          }
          yield* sql`DELETE FROM retired_handles WHERE reserved_until <= ${now}`.pipe(
            Effect.catchCause(() => Effect.void),
          );
          return { visibility: 'public' as const, handle: trimmed };
        }),
      );
    }),
  );
}

export async function handleForGroup(db: ServerDatabase, groupId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ handle: string }>`SELECT handle FROM handles
        WHERE group_id = ${groupId} LIMIT 1`;
    }),
  );
  return row?.handle ?? null;
}
