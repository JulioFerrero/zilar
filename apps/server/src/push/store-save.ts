// The device save keeps one row per identity: a re-registration follows its
// token to the new session, and a revoked session's rows go with it, so the
// component drops the freed node as `unknown-device`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { PushSubscriptionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';
import type { WebPushSubscription } from './subscriptions';

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
            if (!saved) {
              return yield* Effect.fail(
                new HttpError(500, 'internal_error', 'Could not save the push device'),
              );
            }
            return saved;
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
  if (admin !== undefined) {
    for (const node of staleNodes) {
      await admin.disablePushPair(input.userId, node).catch(() => {});
    }
  }
  return row;
}
