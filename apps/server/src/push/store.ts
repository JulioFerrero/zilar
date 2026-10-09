import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { PushSettingRow, PushSubscriptionRow } from '../db/rows';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';
import type { WebPushSubscription } from './subscriptions';

export type PushDeviceRow = PushSubscriptionRow;

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

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

export interface SaveDeviceAdmin {
  /**
   * Drops the ejabberd enable-pair behind a replaced node. The browser's own
   * session should already have disabled it; this is the backstop for
   * clients that re-register without disabling first. Best effort: throws
   * are swallowed by the caller.
   */
  disablePushPair: (userId: string, node: string) => Promise<void>;
}

// Stores one browser subscription. A re-registration of the same endpoint
// replaces the older row for that user (an endpoint identifies one browser
// subscription), so enabling twice does not pile up devices. The stale
// enable-pair behind the replaced row is dropped by the caller (see
// `SaveDeviceAdmin` above): the row delete is scoped by user id AND
// endpoint in the same transaction as the insert, so two racing
// re-registrations cannot leave a duplicate behind.
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
          const [devices] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
            FROM push_subscriptions WHERE user_id = ${input.userId}`;
          if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
            return yield* Effect.fail(
              new HttpError(409, 'too_many_devices', 'Too many push devices'),
            );
          }
          // Read the stale rows (same user, same endpoint, any node) INSIDE the
          // transaction: the read, the deletes and the insert serialize under the
          // per-user lock, so concurrent re-registrations agree on the same set.
          const stale = yield* sql<{ node: string }>`SELECT node FROM push_subscriptions
            WHERE user_id = ${input.userId} AND endpoint = ${input.subscription.endpoint}`;
          staleNodes = stale.map((entry) => entry.node).filter((node) => node !== input.node);
          yield* sql`DELETE FROM push_subscriptions
            WHERE user_id = ${input.userId} AND endpoint = ${input.subscription.endpoint}`;
          const [saved] = yield* sql<PushDeviceRow>`INSERT INTO push_subscriptions
              (id, user_id, node, endpoint, p256dh, auth, user_agent, created_at)
            VALUES (
              ${input.id},
              ${input.userId},
              ${input.node},
              ${input.subscription.endpoint},
              ${cipher.encrypt(input.subscription.keys.p256dh)},
              ${cipher.encrypt(input.subscription.keys.auth)},
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
