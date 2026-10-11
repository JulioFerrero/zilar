import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { PushSettingRow, PushSubscriptionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';
import type { WebPushSubscription } from './subscriptions';

export type PushDeviceRow = PushSubscriptionRow;

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

interface SaveDeviceBase {
  id: string;
  userId: string;
  node: string;
  userAgent: string | null;
  now: Date;
}

// A Web Push registration carries the browser subscription; a native one
// carries the FCM/APNs device token. The kind picks which identity dedupes the
// row: `(user_id, endpoint)` for Web Push, `(user_id, token)` for native.
export type SaveDeviceInput = SaveDeviceBase &
  (
    { kind: 'webpush'; subscription: WebPushSubscription } | { kind: 'fcm' | 'apns'; token: string }
  );

export interface SaveDeviceAdmin {
  /**
   * Drops the ejabberd enable-pair behind a replaced node. The browser's own
   * session should already have disabled it; this is the backstop for
   * clients that re-register without disabling first. Best effort: throws
   * are swallowed by the caller.
   */
  disablePushPair: (userId: string, node: string) => Promise<void>;
}

// Stores one device, idempotently: a re-registration of the same endpoint
// (Web Push) or the same token (native) keeps the existing row's id and node
// and refreshes its fields, so the caller answers the same `{ id, node }` and
// its enable-pair keeps working (T-1150). Legacy duplicates lose: the oldest
// is kept and the rest go to `staleNodes`, all in one locked transaction.
export async function saveDevice(
  db: ServerDatabase,
  cipher: PushCipher,
  input: SaveDeviceInput,
  admin?: SaveDeviceAdmin,
): Promise<PushDeviceRow> {
  let staleNodes: string[] = [];
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`;
          if (input.kind !== 'webpush') {
            // Read this token's rows INSIDE the transaction: the read, the
            // deletes and the write serialize under the per-user lock, so
            // concurrent re-registrations agree on the same set.
            const existing = yield* sql<PushDeviceRow>`SELECT * FROM push_subscriptions
              WHERE user_id = ${input.userId} AND token = ${input.token}
              ORDER BY created_at, id`;
            // A native token is per app install, so it can belong to one
            // account only: drop any row another user holds for it, so a
            // failed sign-out cannot send the previous account's wakes to this
            // phone. The token-only DELETE is atomic and those rows are not
            // this user's pairs, so they stay out of `staleNodes`.
            yield* sql`DELETE FROM push_subscriptions
              WHERE token = ${input.token} AND user_id <> ${input.userId}`;
            const kept = existing[0];
            if (kept !== undefined) {
              // Keep the row's id and node (T-1150): a re-registration must
              // not mint a new node, or the enable it replaces fails on
              // ejabberd's (username, session-timestamp) key. Legacy
              // duplicates lose; their nodes are stale.
              staleNodes = existing
                .slice(1)
                .map((row) => row.node)
                .filter((node) => node !== kept.node);
              yield* sql`DELETE FROM push_subscriptions
                WHERE user_id = ${input.userId} AND token = ${input.token} AND id <> ${kept.id}`;
              const [updated] = yield* sql<PushDeviceRow>`UPDATE push_subscriptions
                  SET kind = ${input.kind}, endpoint = NULL, p256dh = NULL, auth = NULL,
                      token = ${input.token}, user_agent = ${input.userAgent}
                WHERE id = ${kept.id}
                RETURNING *`;
              if (!updated) {
                return yield* Effect.fail(
                  new HttpError(500, 'internal_error', 'Could not save the push device'),
                );
              }
              return updated;
            }
            // A new device counts against the cap; a re-registration does not.
            const [devices] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM push_subscriptions
              WHERE user_id = ${input.userId} AND token IS DISTINCT FROM ${input.token}`;
            if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
              return yield* Effect.fail(
                new HttpError(409, 'too_many_devices', 'Too many push devices'),
              );
            }
            const [saved] = yield* sql<PushDeviceRow>`INSERT INTO push_subscriptions
                (id, user_id, node, kind, endpoint, p256dh, auth, token, user_agent, created_at)
              VALUES (
                ${input.id},
                ${input.userId},
                ${input.node},
                ${input.kind},
                ${null},
                ${null},
                ${null},
                ${input.token},
                ${input.userAgent},
                ${input.now}
              )
              RETURNING *`;
            if (!saved) {
              return yield* Effect.fail(
                new HttpError(500, 'internal_error', 'Could not save the push device'),
              );
            }
            return saved;
          }
          // Read this endpoint's rows INSIDE the transaction, as in the native
          // branch.
          const existing = yield* sql<PushDeviceRow>`SELECT * FROM push_subscriptions
            WHERE user_id = ${input.userId} AND endpoint = ${input.subscription.endpoint}
            ORDER BY created_at, id`;
          const kept = existing[0];
          if (kept !== undefined) {
            staleNodes = existing
              .slice(1)
              .map((row) => row.node)
              .filter((node) => node !== kept.node);
            yield* sql`DELETE FROM push_subscriptions
              WHERE user_id = ${input.userId} AND endpoint = ${input.subscription.endpoint} AND id <> ${kept.id}`;
            const [updated] = yield* sql<PushDeviceRow>`UPDATE push_subscriptions
                SET kind = 'webpush', token = NULL,
                    endpoint = ${input.subscription.endpoint},
                    p256dh = ${cipher.encrypt(input.subscription.keys.p256dh)},
                    auth = ${cipher.encrypt(input.subscription.keys.auth)},
                    user_agent = ${input.userAgent}
              WHERE id = ${kept.id}
              RETURNING *`;
            if (!updated) {
              return yield* Effect.fail(
                new HttpError(500, 'internal_error', 'Could not save the push device'),
              );
            }
            return updated;
          }
          // A new device counts against the cap; a re-registration does not.
          const [devices] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
            FROM push_subscriptions
            WHERE user_id = ${input.userId} AND endpoint IS DISTINCT FROM ${input.subscription.endpoint}`;
          if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
            return yield* Effect.fail(
              new HttpError(409, 'too_many_devices', 'Too many push devices'),
            );
          }
          const [saved] = yield* sql<PushDeviceRow>`INSERT INTO push_subscriptions
              (id, user_id, node, kind, endpoint, p256dh, auth, token, user_agent, created_at)
            VALUES (
              ${input.id},
              ${input.userId},
              ${input.node},
              'webpush',
              ${input.subscription.endpoint},
              ${cipher.encrypt(input.subscription.keys.p256dh)},
              ${cipher.encrypt(input.subscription.keys.auth)},
              ${null},
              ${input.userAgent},
              ${input.now}
            )
            RETURNING *`;
          if (!saved) {
            return yield* Effect.fail(
              new HttpError(500, 'internal_error', 'Could not save the push device'),
            );
          }
          return saved;
        }),
      );
    }),
  );
  // After the commit: tell ejabberd the replaced nodes are dead. Best
  // effort — a failure is a stray `unknown-device` drop, never a failed
  // registration — and no endpoint or key ever leaves this module.
  if (admin !== undefined) {
    for (const node of staleNodes) {
      await admin.disablePushPair(input.userId, node).catch(() => {});
    }
  }
  return row;
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
