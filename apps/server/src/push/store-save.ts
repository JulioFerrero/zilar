// The push device save, split out of `./store` by T-1255 (size split, the
// file was at 400 lines). Moves unchanged: `saveDevice` keeps its per-user
// advisory lock, its in-transaction reads and both branches in their order.
//
// T-1255 adds `session_id`: the session that registered the device is written
// on the insert and on every re-registration, so an old row follows its token
// to the new session. A revoked session's delete then cascades its rows away
// (migration 0051) and the push component drops the publishes for the freed
// node as `unknown-device`, exactly like a removed device.
//
// The column stays nullable: a legacy row (or a caller that omits `sessionId`)
// keeps NULL and is untouched by a session delete.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { PushSubscriptionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { PushCipher } from './crypto';
import type { WebPushSubscription } from './subscriptions';

// At most this many browsers per user, enforced atomically: the whole
// save runs in one transaction under a per-user advisory lock, and the
// count is read inside it, so concurrent subscribes cannot jointly pass
// the check (same pattern as the pins cap).
export const PUSH_MAX_DEVICES_PER_USER = 20;

interface SaveDeviceBase {
  id: string;
  userId: string;
  node: string;
  userAgent: string | null;
  now: Date;
  // The session that registered the device. Optional so a legacy caller (an
  // old test fixture) can omit it and leave the row's `session_id` NULL.
  sessionId?: string | null;
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
            // Read this token's rows INSIDE the transaction: the read, the
            // deletes and the write serialize under the per-user lock, so
            // concurrent re-registrations agree on the same set.
            const existing = yield* sql<PushSubscriptionRow>`SELECT * FROM push_subscriptions
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
            // A new device counts against the cap; a re-registration does not.
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
          // Read this endpoint's rows INSIDE the transaction, as in the native
          // branch.
          // One owner per endpoint, as in the native branch: drop rows
          // another user holds for it. Not this user's pairs: out of staleNodes.
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
          // A new device counts against the cap; a re-registration does not.
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
