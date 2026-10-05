// T-0164: public visibility for groups and channels. A public group holds
// exactly one `handles` row (`group_id`, same namespace as T-0163
// `@username`s) and appears in the directory; a private group holds none
// and stays invisible and invite-only.

import { eq, lte, sql } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { groupMembers, groups, handles, retiredHandles } from '../db/schema';
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

// Makes a group public (with a handle) or private again, in one
// transaction under a per-group advisory lock, so concurrent writers
// serialize and the handle rows the decision depends on are read INSIDE
// the transaction (never check-then-insert):
// - Only the owner may change visibility: a non-owner — and a stranger —
//   sees the same 404 as a missing group (like `changeMemberRole`).
// - Public needs a valid handle (T-0163 shape, reserved words and
//   case-insensitive uniqueness through the primary key): `handle_invalid` /
//   `handle_reserved` / `handle_taken`. Same handle (case-insensitively) is
//   a no-op for the rows, but a casing-only change still obeys the 14-day
//   interval and updates the stored casing — like the user claim path.
// - Going public again within 30 days of going private may reuse the
//   reserved handle (it is reserved for this group); anyone else's
//   reservation reads as `handle_taken`. A handle change obeys the same
//   14-day interval as users (409 `handle_change_too_soon` + `nextChangeAt`
//   in the error detail).
// - Public to private moves the handle row to `retired_handles` (reserved
//   30 days for this group); members stay members; the group vanishes from
//   the directory at once (directory reads `visibility = 'public'`).
// Audit entries are written by the route, after the commit (ids only).
export async function setGroupVisibility(
  db: ServerDatabase,
  input: SetGroupVisibilityInput,
): Promise<SetGroupVisibilityResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'group-visibility:' + input.groupId}))`,
    );

    const [group] = await tx.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
    const [membership] = group
      ? await tx
          .select({ role: groupMembers.role })
          .from(groupMembers)
          .where(
            sql`${groupMembers.groupId} = ${input.groupId} AND ${groupMembers.userId} = ${input.actorId}`,
          )
          .limit(1)
      : [];
    // A non-member sees the same 404 as a missing group; only the owner
    // may touch visibility.
    if (!group || !membership || membership.role !== 'owner') {
      throw new HttpError(404, 'not_found', 'Group not found');
    }

    const [live] = await tx
      .select()
      .from(handles)
      .where(eq(handles.groupId, input.groupId))
      .limit(1);
    const currentVisibility: GroupVisibility = group.visibility;

    if (input.visibility === 'private') {
      if (input.handle !== undefined) {
        throw new HttpError(400, 'invalid_request', 'A private group has no handle');
      }
      if (live) {
        await tx.delete(handles).where(eq(handles.handleLower, live.handleLower));
        const reservedUntil = new Date(
          now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000,
        );
        await tx
          .insert(retiredHandles)
          .values({
            handleLower: live.handleLower,
            formerUserId: null,
            formerGroupId: input.groupId,
            reservedUntil,
          })
          .onConflictDoUpdate({
            target: retiredHandles.handleLower,
            set: { formerUserId: null, formerGroupId: input.groupId, reservedUntil },
          });
      }
      if (currentVisibility !== 'private') {
        await tx.update(groups).set({ visibility: 'private' }).where(eq(groups.id, input.groupId));
      }
      return { visibility: 'private' as const, handle: null };
    }

    // Going public (or staying public with a new handle).
    const trimmed = (input.handle ?? '').trim();
    if (trimmed === '') {
      throw new HttpError(400, 'invalid_request', 'A public group needs a handle');
    }
    const rule = classifyHandle(trimmed);
    if (rule === 'invalid') {
      throw new HttpError(400, 'handle_invalid', 'That handle is not valid');
    }
    if (rule === 'reserved') {
      throw new HttpError(409, 'handle_reserved', 'That handle is reserved');
    }
    const lower = normalizeHandle(trimmed);

    // Same handle (case-insensitively): a no-op for the rows, but a
    // casing-only change still obeys the 14-day interval and updates the
    // stored casing — like the user claim path.
    if (live && live.handleLower === lower) {
      if (live.handle !== trimmed) {
        const nextChangeAt = new Date(
          live.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
        );
        if (now.getTime() < nextChangeAt.getTime()) {
          throw new HttpError(409, 'handle_change_too_soon', 'You can change it again', {
            nextChangeAt: nextChangeAt.toISOString(),
          });
        }
        await tx
          .update(handles)
          .set({ handle: trimmed, changedAt: now })
          .where(eq(handles.handleLower, live.handleLower));
      }
      if (currentVisibility !== 'public') {
        await tx.update(groups).set({ visibility: 'public' }).where(eq(groups.id, input.groupId));
      }
      return { visibility: 'public' as const, handle: trimmed };
    }

    // A different handle: the 14-day interval counts from the current
    // handle's last change (a brand-new public group has no handle yet, so
    // the first claim is always allowed).
    if (live) {
      const nextChangeAt = new Date(
        live.changedAt.getTime() + HANDLE_CHANGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
      );
      if (now.getTime() < nextChangeAt.getTime()) {
        throw new HttpError(409, 'handle_change_too_soon', 'You can change it again', {
          nextChangeAt: nextChangeAt.toISOString(),
        });
      }
    }

    // Claim the wanted handle: a live row owned by someone else (a user or
    // another group) is taken; a retired reservation belongs to its former
    // owner only — this group may reclaim its own, an expired one reads as
    // free. The insert races on the primary key (exactly one wins), and a
    // violation maps to 409 `handle_taken`.
    const [taken] = await tx.select().from(handles).where(eq(handles.handleLower, lower)).limit(1);
    if (taken) {
      throw new HttpError(409, 'handle_taken', 'That handle is taken');
    }
    const [retired] = await tx
      .select()
      .from(retiredHandles)
      .where(eq(retiredHandles.handleLower, lower))
      .limit(1);
    if (retired) {
      const reserved = retired.reservedUntil.getTime() > now.getTime();
      if (reserved && retired.formerGroupId !== input.groupId) {
        throw new HttpError(409, 'handle_taken', 'That handle is taken');
      }
      await tx.delete(retiredHandles).where(eq(retiredHandles.handleLower, lower));
    }

    if (live) {
      await tx.delete(handles).where(eq(handles.handleLower, live.handleLower));
      const reservedUntil = new Date(now.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000);
      await tx
        .insert(retiredHandles)
        .values({
          handleLower: live.handleLower,
          formerUserId: null,
          formerGroupId: input.groupId,
          reservedUntil,
        })
        .onConflictDoUpdate({
          target: retiredHandles.handleLower,
          set: { formerUserId: null, formerGroupId: input.groupId, reservedUntil },
        });
    }

    try {
      const [row] = await tx
        .insert(handles)
        .values({
          handleLower: lower,
          handle: trimmed,
          userId: null,
          groupId: input.groupId,
          createdAt: now,
          changedAt: now,
        })
        .returning();
      if (!row) {
        throw new Error('group handle insert returned no row');
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, 'handle_taken', 'That handle is taken');
      }
      throw error;
    }
    if (currentVisibility !== 'public') {
      await tx.update(groups).set({ visibility: 'public' }).where(eq(groups.id, input.groupId));
    }
    await reapExpiredRetiredHandles(tx as unknown as ServerDatabase, now);
    return { visibility: 'public' as const, handle: trimmed };
  });
}

// Reaps expired retired rows opportunistically after a claim, so the table
// does not grow forever. Best effort: a failure never fails the change.
async function reapExpiredRetiredHandles(db: ServerDatabase, now: Date): Promise<void> {
  try {
    await db.delete(retiredHandles).where(lte(retiredHandles.reservedUntil, now));
  } catch {
    // Best effort only.
  }
}

// The handle of a group (null while private), for the member detail views.
export async function handleForGroup(db: ServerDatabase, groupId: string): Promise<string | null> {
  const [row] = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(eq(handles.groupId, groupId))
    .limit(1);
  return row?.handle ?? null;
}
