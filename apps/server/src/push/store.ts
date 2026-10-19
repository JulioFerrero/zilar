import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { isAllowedPushEndpoint } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import type { PushDeviceKind, PushSettingRow, PushSubscriptionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';

// A device that received nothing for this long is listed as inactive. A
// device that never received anything counts from its registration.
export const PUSH_INACTIVE_AFTER_DAYS = 90;

export interface PushDeviceView {
  id: string;
  kind: PushDeviceKind;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  failedAt: string | null;
  lastFailure: string | null;
  inactive: boolean;
}

export function toPushDeviceView(row: PushSubscriptionRow, now: Date): PushDeviceView {
  const last = row.lastUsedAt ?? row.createdAt;
  const inactiveDays = (now.getTime() - last.getTime()) / (24 * 3600 * 1000);
  return {
    id: row.id,
    kind: row.kind,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    failedAt: row.failedAt === null ? null : row.failedAt.toISOString(),
    lastFailure: row.lastFailure,
    inactive: inactiveDays >= PUSH_INACTIVE_AFTER_DAYS,
  };
}

function requireSaved(
  row: PushSubscriptionRow | undefined,
): Effect.Effect<PushSubscriptionRow, HttpError> {
  return row === undefined
    ? Effect.fail(new HttpError(500, 'internal_error', 'Could not save the push device'))
    : Effect.succeed(row);
}

export async function devicesForUser(
  db: ServerDatabase,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushSubscriptionRow>`SELECT * FROM push_subscriptions
        WHERE user_id = ${userId}`;
    }),
  );
  return [...rows];
}

// Every user id holding a push device; the room sync intersects this so
// only members with a device are subscribed.
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

// A device id that is unknown or belongs to someone else answers false,
// and the route 404s both the same way.
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
): Promise<PushSubscriptionRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PushSubscriptionRow>`SELECT * FROM push_subscriptions
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
        SET last_used_at = ${now}, failed_at = NULL, last_failure = NULL
        WHERE id = ${deviceId}`;
    }),
  );
}

export async function markDeviceFailed(
  db: ServerDatabase,
  deviceId: string,
  now: Date,
  lastFailure: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE push_subscriptions
        SET failed_at = ${now}, last_failure = ${lastFailure}
        WHERE id = ${deviceId}`;
    }),
  );
}

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

export function openDevice(
  cipher: PushCipher,
  row: PushSubscriptionRow,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (row.endpoint === null || row.p256dh === null || row.auth === null) {
    throw new Error('The push device is not a Web Push device');
  }
  return {
    endpoint: row.endpoint,
    keys: { p256dh: cipher.decrypt(row.p256dh), auth: cipher.decrypt(row.auth) },
  };
}

export function openNativeDevice(row: PushSubscriptionRow): {
  kind: 'fcm' | 'apns';
  token: string;
} {
  if (row.kind === 'webpush' || row.token === null) {
    throw new Error('The push device is not a native device');
  }
  return { kind: row.kind, token: row.token };
}

// The browser's PushSubscription JSON, validated at the route boundary
// before anything is stored.
const WebPushKeysSchema = struct({
  p256dh: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  auth: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

// The endpoint must be a real Web Push service address: the shared allowlist
// rejects internal hosts, other ports and plain http.
const WebPushSubscriptionSchema = struct({
  endpoint: Schema.String.pipe(
    Schema.check(
      Schema.isMaxLength(2048),
      Schema.makeFilter((value) =>
        isAllowedPushEndpoint(value) ? undefined : 'must be a Web Push service endpoint',
      ),
    ),
  ),
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: WebPushKeysSchema,
});

type WebPushSubscription = Schema.Schema.Type<typeof WebPushSubscriptionSchema>;

export const PUSH_MAX_DEVICES_PER_USER = 20;

interface SaveDeviceBase {
  id: string;
  userId: string;
  node: string;
  userAgent: string | null;
  now: Date;
  sessionId?: string | null;
}

export type SaveDeviceInput = SaveDeviceBase &
  (
    { kind: 'webpush'; subscription: WebPushSubscription } | { kind: 'fcm' | 'apns'; token: string }
  );

export interface SaveDeviceAdmin {
  /** Drops the ejabberd enable-pair behind a replaced node, as a backstop for
   * clients that re-register without disabling first. Best effort. */
  disablePushPair: (userId: string, node: string) => Promise<void>;
}

// Stores one device idempotently: a re-registration of the same endpoint or
// token keeps the row's id and node and refreshes its fields. Legacy
// duplicates lose: the oldest is kept, the rest go to `staleNodes`.
// The device save keeps one row per identity: a re-registration follows its
// token to the new session, and a revoked session's rows go with it, so the
// component drops the freed node as `unknown-device`.
export async function saveDevice(
  db: ServerDatabase,
  cipher: PushCipher,
  input: SaveDeviceInput,
  admin?: SaveDeviceAdmin,
): Promise<PushSubscriptionRow> {
  const sessionId = input.sessionId ?? null;
  let staleNodes: string[] = [];
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`;
          if (input.kind !== 'webpush') {
            const existing = yield* sql<PushSubscriptionRow>`SELECT * FROM push_subscriptions
              WHERE user_id = ${input.userId} AND token = ${input.token}
              ORDER BY created_at, id`;
            // A native token is per install and can belong to one account only: drop any
            // row another user holds, so a failed sign-out cannot send the previous
            // account's wakes. Those rows are not this user's pairs, so they stay out of
            // `staleNodes`.
            yield* sql`DELETE FROM push_subscriptions
              WHERE token = ${input.token} AND user_id <> ${input.userId}`;
            const kept = existing[0];
            if (kept !== undefined) {
              staleNodes = existing
                .slice(1)
                .map((row) => row.node)
                .filter((node) => node !== kept.node);
              yield* sql`DELETE FROM push_subscriptions
                WHERE user_id = ${input.userId} AND token = ${input.token} AND id <> ${kept.id}`;
              const [updated] = yield* sql<PushSubscriptionRow>`UPDATE push_subscriptions
                  SET kind = ${input.kind}, endpoint = NULL, p256dh = NULL, auth = NULL,
                      token = ${input.token}, user_agent = ${input.userAgent},
                      session_id = ${sessionId}
                WHERE id = ${kept.id}
                RETURNING *`;
              if (!updated) {
                return yield* Effect.fail(
                  new HttpError(500, 'internal_error', 'Could not save the push device'),
                );
              }
              return updated;
            }
            const [devices] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM push_subscriptions
              WHERE user_id = ${input.userId} AND token IS DISTINCT FROM ${input.token}`;
            if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
              return yield* Effect.fail(
                new HttpError(409, 'too_many_devices', 'Too many push devices'),
              );
            }
            const [saved] = yield* sql<PushSubscriptionRow>`INSERT INTO push_subscriptions
                (id, user_id, node, kind, endpoint, p256dh, auth, token, user_agent, session_id, created_at)
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
                ${sessionId},
                ${input.now}
              )
              RETURNING *`;
            return yield* requireSaved(saved);
          }
          yield* sql`DELETE FROM push_subscriptions
            WHERE endpoint = ${input.subscription.endpoint} AND user_id <> ${input.userId}`;
          const existing = yield* sql<PushSubscriptionRow>`SELECT * FROM push_subscriptions
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
            const [updated] = yield* sql<PushSubscriptionRow>`UPDATE push_subscriptions
                SET kind = 'webpush', token = NULL,
                    endpoint = ${input.subscription.endpoint},
                    p256dh = ${cipher.encrypt(input.subscription.keys.p256dh)},
                    auth = ${cipher.encrypt(input.subscription.keys.auth)},
                    user_agent = ${input.userAgent},
                    session_id = ${sessionId}
              WHERE id = ${kept.id}
              RETURNING *`;
            if (!updated) {
              return yield* Effect.fail(
                new HttpError(500, 'internal_error', 'Could not save the push device'),
              );
            }
            return updated;
          }
          const [devices] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
            FROM push_subscriptions
            WHERE user_id = ${input.userId} AND endpoint IS DISTINCT FROM ${input.subscription.endpoint}`;
          if (Number(devices?.total ?? 0) >= PUSH_MAX_DEVICES_PER_USER) {
            return yield* Effect.fail(
              new HttpError(409, 'too_many_devices', 'Too many push devices'),
            );
          }
          const [saved] = yield* sql<PushSubscriptionRow>`INSERT INTO push_subscriptions
              (id, user_id, node, kind, endpoint, p256dh, auth, token, user_agent, session_id, created_at)
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
              ${sessionId},
              ${input.now}
            )
            RETURNING *`;
          return yield* requireSaved(saved);
        }),
      );
    }),
  );
  if (admin !== undefined) {
    for (const node of staleNodes) {
      await admin.disablePushPair(input.userId, node).catch(() => {});
    }
  }
  return row;
}
