import { and, count, eq, sql } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { pushSettings, pushSubscriptions } from '../db/schema';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';
import type { WebPushSubscription } from './subscriptions';

export type PushDeviceRow = typeof pushSubscriptions.$inferSelect;

// At most this many browsers per user, enforced atomically: the whole
// save runs in one transaction under a per-user advisory lock, and the
// count is read inside it, so concurrent subscribes cannot jointly pass
// the check (same pattern as the pins cap).
export const PUSH_MAX_DEVICES_PER_USER = 20;

// A device that received nothing for this long is listed as inactive. A
// device that never received anything counts from its registration.
export const PUSH_INACTIVE_AFTER_DAYS = 90;

export interface PushDeviceView {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  inactive: boolean;
}

export function toPushDeviceView(row: PushDeviceRow, now: Date): PushDeviceView {
  const last = row.lastUsedAt ?? row.createdAt;
  const inactiveDays = (now.getTime() - last.getTime()) / (24 * 3600 * 1000);
  return {
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    inactive: inactiveDays >= PUSH_INACTIVE_AFTER_DAYS,
  };
}

export interface SaveDeviceInput {
  id: string;
  userId: string;
  node: string;
  subscription: WebPushSubscription;
  userAgent: string | null;
  now: Date;
}

// Stores one browser subscription. A re-registration of the same endpoint
// replaces the older row for that user (an endpoint identifies one browser
// subscription), so enabling twice does not pile up devices.
export async function saveDevice(
  db: ServerDatabase,
  cipher: PushCipher,
  input: SaveDeviceInput,
): Promise<PushDeviceRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const [devices] = await tx
      .select({ total: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, input.userId));
    if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
      throw new HttpError(409, 'too_many_devices', 'Too many push devices');
    }
    await tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, input.userId),
          eq(pushSubscriptions.endpoint, input.subscription.endpoint),
        ),
      );
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        id: input.id,
        userId: input.userId,
        node: input.node,
        endpoint: input.subscription.endpoint,
        p256dh: cipher.encrypt(input.subscription.keys.p256dh),
        auth: cipher.encrypt(input.subscription.keys.auth),
        userAgent: input.userAgent,
        createdAt: input.now,
      })
      .returning();
    if (!row) {
      throw new HttpError(500, 'internal_error', 'Could not save the push device');
    }
    return row;
  });
}

export async function devicesForUser(db: ServerDatabase, userId: string): Promise<PushDeviceRow[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

// Every user id holding at least one push device. The room sync intersects
// this with the desired members, so only members with a device are
// subscribed to a room for push.
export async function userIdsWithDevices(db: ServerDatabase): Promise<Set<string>> {
  const rows = await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  return new Set(rows.map((row) => row.userId));
}

// Scoped delete: a device id that is unknown or belongs to someone else
// answers false, and the route 404s both the same way.
export async function removeDevice(
  db: ServerDatabase,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, deviceId), eq(pushSubscriptions.userId, userId)))
    .returning();
  return deleted.length > 0;
}

export async function deviceByNode(
  db: ServerDatabase,
  node: string,
): Promise<PushDeviceRow | undefined> {
  const [row] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.node, node))
    .limit(1);
  return row;
}

export async function removeDeviceByNode(db: ServerDatabase, node: string): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.node, node))
    .returning();
  return deleted.length > 0;
}

export async function markDeviceUsed(
  db: ServerDatabase,
  deviceId: string,
  now: Date,
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAt: now, failedAt: null })
    .where(eq(pushSubscriptions.id, deviceId));
}

export async function markDeviceFailed(
  db: ServerDatabase,
  deviceId: string,
  now: Date,
): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ failedAt: now })
    .where(eq(pushSubscriptions.id, deviceId));
}

// The user's "Show message previews" setting. Absent = on (previews are the
// chat-app default; turning them off is the explicit privacy choice).
export async function showPreviewsForUser(db: ServerDatabase, userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(pushSettings)
    .where(eq(pushSettings.userId, userId))
    .limit(1);
  return row?.showPreviews ?? true;
}

export async function setShowPreviewsForUser(
  db: ServerDatabase,
  userId: string,
  showPreviews: boolean,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .insert(pushSettings)
    .values({ userId, showPreviews, updatedAt: now })
    .onConflictDoUpdate({
      target: pushSettings.userId,
      set: { showPreviews, updatedAt: now },
    })
    .returning();
  return row?.showPreviews ?? showPreviews;
}

// Opens one stored device for sending: decrypts the sealed keys. A row that
// no longer decrypts (rotated storage key) is unusable — the caller drops it
// and answers the IQ with `result` like any other send failure.
export function openDevice(
  cipher: PushCipher,
  row: PushDeviceRow,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: cipher.decrypt(row.p256dh), auth: cipher.decrypt(row.auth) },
  };
}
