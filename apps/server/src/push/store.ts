import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { PushSettingRow, PushSubscriptionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { PushCipher } from './crypto';

export type PushDeviceRow = PushSubscriptionRow;

// `saveDevice`, its input types and the device cap live in `./store-save`
// (T-1255 size split); callers keep importing them from `./store`.
export {
  PUSH_MAX_DEVICES_PER_USER,
  saveDevice,
  type SaveDeviceAdmin,
  type SaveDeviceInput,
} from './store-save';

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

export async function devicesForUser(db: ServerDatabase, userId: string): Promise<PushDeviceRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushDeviceRow>`SELECT * FROM push_subscriptions
        WHERE user_id = ${userId}`;
    }),
  );
  return [...rows];
}

// Every user id holding at least one push device. The room sync intersects
// this with the desired members, so only members with a device are
// subscribed to a room for push.
export async function userIdsWithDevices(db: ServerDatabase): Promise<Set<string>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM push_subscriptions`;
    }),
  );
  return new Set(rows.map((row) => row.userId));
}

// Scoped delete: a device id that is unknown or belongs to someone else
// answers false, and the route 404s both the same way.
export async function removeDevice(
  db: ServerDatabase,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const deleted = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM push_subscriptions
        WHERE id = ${deviceId} AND user_id = ${userId}
        RETURNING id`;
    }),
  );
  return deleted.length > 0;
}

export async function deviceByNode(
  db: ServerDatabase,
  node: string,
): Promise<PushDeviceRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushDeviceRow>`SELECT * FROM push_subscriptions
        WHERE node = ${node} LIMIT 1`;
    }),
  );
  return row;
}

export async function removeDeviceByNode(db: ServerDatabase, node: string): Promise<boolean> {
  const deleted = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM push_subscriptions
        WHERE node = ${node}
        RETURNING id`;
    }),
  );
  return deleted.length > 0;
}

export async function markDeviceUsed(
  db: ServerDatabase,
  deviceId: string,
  now: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE push_subscriptions
        SET last_used_at = ${now}, failed_at = NULL
        WHERE id = ${deviceId}`;
    }),
  );
}

export async function markDeviceFailed(
  db: ServerDatabase,
  deviceId: string,
  now: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE push_subscriptions
        SET failed_at = ${now}
        WHERE id = ${deviceId}`;
    }),
  );
}

// The user's "Show message previews" setting. Absent = on (previews are the
// chat-app default; turning them off is the explicit privacy choice).
export async function showPreviewsForUser(db: ServerDatabase, userId: string): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushSettingRow>`SELECT * FROM push_settings
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row?.showPreviews ?? true;
}

export async function setShowPreviewsForUser(
  db: ServerDatabase,
  userId: string,
  showPreviews: boolean,
  now: Date,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushSettingRow>`INSERT INTO push_settings
          (user_id, show_previews, updated_at)
        VALUES (${userId}, ${showPreviews}, ${now})
        ON CONFLICT (user_id) DO UPDATE SET
          show_previews = EXCLUDED.show_previews,
          updated_at = EXCLUDED.updated_at
        RETURNING *`;
    }),
  );
  return row?.showPreviews ?? showPreviews;
}

// Opens one stored Web Push device for sending: decrypts the sealed keys. A
// row that is not a Web Push row (its endpoint or keys are NULL — a native
// device) or that no longer decrypts (rotated storage key) is unusable — the
// caller drops it and answers the IQ with `result` like any other send failure.
export function openDevice(
  cipher: PushCipher,
  row: PushDeviceRow,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (row.endpoint === null || row.p256dh === null || row.auth === null) {
    throw new Error('The push device is not a Web Push device');
  }
  return {
    endpoint: row.endpoint,
    keys: { p256dh: cipher.decrypt(row.p256dh), auth: cipher.decrypt(row.auth) },
  };
}

// Opens one stored native device for sending: the FCM/APNs token is stored in
// the clear (`token` is a delivery address, not a credential), so there is
// nothing to decrypt. A row that is not native is a programming error — the
// caller branches on `kind` first.
export function openNativeDevice(row: PushDeviceRow): { kind: 'fcm' | 'apns'; token: string } {
  if (row.kind === 'webpush' || row.token === null) {
    throw new Error('The push device is not a native device');
  }
  return { kind: row.kind, token: row.token };
}
