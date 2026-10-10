// Push module on the Effect `HttpApi` adapter (T-0543): the same methods,
// paths, statuses, bodies, texts and per-route step order as the retired
// router, mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its store runs on effect/sql.
//
// The three bodies are decoded manually inside their handlers (Effect Schema,
// same rules as the old zod schemas) instead of as endpoint payloads, so each
// route keeps its exact order: `requirePush()` runs before the decode, and
// the decode runs before that route's limiter check — exactly like the old
// `requireSession` -> `requirePush` -> decode -> limiter sequence. The DELETE
// limiter is also checked inside its handler (after `requirePush`), for the
// same reason. No decode text changes: every failure answers byte-identical
// codes and messages.
//
// The subscribe body reuses the Effect schemas in `./subscriptions`, so the
// route and the stored subscription share one set of rules.

import { randomUUID } from 'node:crypto';
import { Effect, Layer, Option, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { struct } from '@zilar/protocol';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  SchemaErrors,
  Session,
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { createPushCipher } from './crypto';
import { pushConfigError, type PushConfig } from './config';
import { parseNode, randomNode } from './protocol';
import { createWebPushSender, isExpiredSubscription, type WebPushDelivery } from './sender';
import { WebPushKeysSchema, WebPushSubscriptionSchema } from './subscriptions';
import {
  devicesForUser,
  markDeviceFailed,
  markDeviceUsed,
  removeDevice,
  saveDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';

export const PUSH_SUBSCRIBE_RATE_LIMIT_MAX = 30;
export const PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_SETTINGS_RATE_LIMIT_MAX = 60;
export const PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_TEST_RATE_LIMIT_MAX = 5;
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface PushRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Push env (kept separate from the server config so push stays optional). */
  push: PushConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  /** Injected in tests so the rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests so no real push relay is ever called. */
  sender?: WebPushDelivery;
}

export interface PushApiDependencies extends PushRoutesDependencies {
  subscribeLimiter?: RateLimiter;
  settingsLimiter?: RateLimiter;
  testLimiter?: RateLimiter;
}

// The subscribe body reuses the stored subscription schemas: the endpoint,
// expiration time and keys are exactly `WebPushSubscriptionSchema`, and
// `userAgent` is the extra device label. `struct` keeps zod's mutable field
// types.
const SubscribeBody = struct({
  endpoint: WebPushSubscriptionSchema.fields.endpoint,
  expirationTime: WebPushSubscriptionSchema.fields.expirationTime,
  keys: WebPushKeysSchema,
  userAgent: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)))),
  ),
});

// Replaces `showPreviewsSchema` (zod strict): excess keys fail the decode.
const ShowPreviewsBody = struct({
  showPreviews: Schema.Boolean,
});

// Replaces `testSchema` (zod strict): excess keys fail the decode.
const TestBody = struct({
  subscriptionId: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

const PushConfigView = Schema.Struct({
  vapidPublicKey: Schema.String,
  pushJid: Schema.String,
});

const PushDeviceView = Schema.Struct({
  id: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  inactive: Schema.Boolean,
});

const PushDeviceList = Schema.Struct({ devices: Schema.Array(PushDeviceView) });

const PushRegistration = Schema.Struct({
  id: Schema.String,
  node: Schema.String,
  jid: Schema.String,
});

const PushRemoved = Schema.Struct({ removed: Schema.Boolean });

const PushSettingsView = Schema.Struct({ showPreviews: Schema.Boolean });

const PushTestResult = Schema.Struct({ sent: Schema.Boolean });

const PushDeviceParams = Schema.Struct({ id: Schema.String });

const PushGroup = HttpApiGroup.make('push')
  .add(
    HttpApiEndpoint.get('config', '/push/config', {
      success: PushConfigView,
    }),
    HttpApiEndpoint.post('subscribe', '/push/subscriptions', {
      success: PushRegistration,
    }),
    HttpApiEndpoint.get('list', '/push/subscriptions', {
      success: PushDeviceList,
    }),
    HttpApiEndpoint.delete('remove', '/push/subscriptions/:id', {
      params: PushDeviceParams,
      success: PushRemoved,
    }),
    HttpApiEndpoint.get('settings', '/push/settings', {
      success: PushSettingsView,
    }),
    HttpApiEndpoint.put('updateSettings', '/push/settings', {
      success: PushSettingsView,
    }),
    HttpApiEndpoint.post('test', '/push/test', {
      success: PushTestResult,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const PushApi = HttpApi.make('push').add(PushGroup);

// Driver failures can be wrapped, so the unique code (23505 on Postgres and
// PGlite) lives on a nested `cause`. Walk the chain.
function isUniqueViolation(error: unknown): boolean {
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

// Logs the error class only, never the message: a sync failure surfaces
// driver text that could echo query parameters.
function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

export function createPushApi(deps: PushApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const subscribeLimiter =
    deps.subscribeLimiter ??
    createRateLimiter({
      max: PUSH_SUBSCRIBE_RATE_LIMIT_MAX,
      windowMs: PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const settingsLimiter =
    deps.settingsLimiter ??
    createRateLimiter({
      max: PUSH_SETTINGS_RATE_LIMIT_MAX,
      windowMs: PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const testLimiter =
    deps.testLimiter ??
    createRateLimiter({
      max: PUSH_TEST_RATE_LIMIT_MAX,
      windowMs: PUSH_TEST_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function requirePush(): { storageKey: string } {
    if (!deps.push.PUSH_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const error = pushConfigError(deps.push);
    if (error !== null) {
      throw new HttpError(503, 'push_unavailable', 'Push notifications are not configured');
    }
    return { storageKey: deps.push.PUSH_STORAGE_KEY as string };
  }

  const groupLayer = HttpApiBuilder.group(PushApi, 'push', (handlers) =>
    handlers
      .handle(
        'config',
        handler(logger, () =>
          Effect.sync(() => {
            requirePush();
            return {
              vapidPublicKey: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
              pushJid: deps.push.PUSH_COMPONENT_JID as string,
            };
          }),
        ),
      )
      .handle(
        'subscribe',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const { storageKey } = requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
            );
            const decoded = Schema.decodeUnknownOption(SubscribeBody)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_subscription', 'The push subscription is invalid');
            }
            if (!subscribeLimiter.allow(user.id)) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many push registrations, try again later',
              );
            }
            const body = decoded.value;
            const cipher = createPushCipher(storageKey);
            const pushJid = deps.push.PUSH_COMPONENT_JID as string;
            // A replaced node leaves a stale enable-pair behind in ejabberd
            // (XEP-0357 session state). No admin command targets a push pair
            // by node, so this only re-syncs the user's room subscriptions.
            // What actually stops delivery to the old pair is that its device
            // row is gone: the push component drops publishes for an unknown
            // node. The browser's own session normally sends `<disable/>` for
            // the old pair itself. Best effort: a failure never fails the
            // registration (no endpoint or key in the logs — user id only).
            const dropStalePushPairs = (staleNodes: string[]): Effect.Effect<void> =>
              Effect.promise(async () => {
                if (staleNodes.length === 0) {
                  return;
                }
                try {
                  await syncPushSubscriptionsForUser(
                    {
                      db: deps.db,
                      adminClient: deps.adminClient,
                      domain: deps.config.xmpp.domain,
                      logger: deps.logger,
                    },
                    user.id,
                  );
                } catch (error) {
                  deps.logger.warn(
                    { userId: user.id, staleNodes: staleNodes.length, err: errorName(error) },
                    'push room re-sync failed after node replacement; the old node drops as unknown-device',
                  );
                }
              });
            let node = randomNode();
            parseNode(node);
            for (let attempt = 0; attempt < 3; attempt += 1) {
              // A rejection surfaces as a defect, which `yield*` does not
              // throw into the surrounding `try`; map it to a value so the
              // unique-violation retry below can inspect it.
              const outcome = yield* Effect.promise(() =>
                saveDevice(
                  deps.db,
                  cipher,
                  {
                    id: randomUUID(),
                    userId: user.id,
                    node,
                    subscription: {
                      endpoint: body.endpoint,
                      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
                      ...(body.expirationTime === undefined
                        ? {}
                        : { expirationTime: body.expirationTime }),
                    },
                    userAgent: body.userAgent ?? null,
                    now: new Date(now()),
                  },
                  {
                    disablePushPair: (_userId, _node) =>
                      Effect.runPromise(dropStalePushPairs([_node])),
                  },
                ),
              ).pipe(
                Effect.map((row) => ({ saved: true as const, row })),
                Effect.catchDefect((defect) => Effect.succeed({ saved: false as const, defect })),
              );
              if (!outcome.saved) {
                if (isUniqueViolation(outcome.defect)) {
                  node = randomNode();
                  continue;
                }
                return yield* Effect.die(outcome.defect);
              }
              const row = outcome.row;
              // The device is stored: subscribe the user to every room they
              // may see so MUC/Sub events reach them while offline. Best
              // effort — a room failure never fails the registration
              // (membership changes re-sync later). The sync's own DB reads
              // can throw after the row committed, so a failure here must
              // not 500 an operation that already succeeded: log ids only
              // and answer success (S2).
              yield* Effect.promise(() =>
                syncPushSubscriptionsForUser(
                  {
                    db: deps.db,
                    adminClient: deps.adminClient,
                    domain: deps.config.xmpp.domain,
                    logger: deps.logger,
                  },
                  user.id,
                ),
              ).pipe(
                Effect.catchDefect((defect) =>
                  Effect.sync(() => {
                    deps.logger.warn(
                      { userId: user.id, err: errorName(defect) },
                      'push room sync failed after registration; membership changes re-sync later',
                    );
                  }),
                ),
              );
              return { id: row.id, node: row.node, jid: pushJid };
            }
            throw new HttpError(503, 'push_unavailable', 'Could not register the push device');
          }),
        ),
      )
      .handle(
        'list',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            requirePush();
            const current = new Date(now());
            const devices = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            // The list carries labels and dates only — never the endpoint URL
            // or the sealed keys.
            return { devices: devices.map((row) => toPushDeviceView(row, current)) };
          }),
        ),
      )
      .handle(
        'remove',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            // Device add and remove share the registration window: both are
            // cheap writes, and an uncapped remove would let a client churn
            // the room subscriptions below.
            if (!subscribeLimiter.allow(user.id)) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many push registrations, try again later',
              );
            }
            // Scoped delete: an unknown id and another user's device answer
            // the same 404, so device ids cannot be probed.
            const removed = yield* Effect.promise(() =>
              removeDevice(deps.db, user.id, request.params.id),
            );
            if (!removed) {
              throw new HttpError(404, 'not_found', 'Push device not found');
            }
            // No devices left: drop the MUC/Sub room subscriptions too, so
            // ejabberd stops publishing for a user who cannot receive
            // anything. Best effort after the committed delete: a sync
            // failure logs and still answers success (S2).
            const remaining = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            if (remaining.length === 0) {
              yield* Effect.promise(() =>
                syncPushSubscriptionsForUser(
                  {
                    db: deps.db,
                    adminClient: deps.adminClient,
                    domain: deps.config.xmpp.domain,
                    logger: deps.logger,
                  },
                  user.id,
                ),
              ).pipe(
                Effect.catchDefect((defect) =>
                  Effect.sync(() => {
                    deps.logger.warn(
                      { userId: user.id, err: errorName(defect) },
                      'push room sync failed after device removal; membership changes re-sync later',
                    );
                  }),
                ),
              );
            }
            return { removed: true };
          }),
        ),
      )
      .handle(
        'settings',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            requirePush();
            return {
              showPreviews: yield* Effect.promise(() => showPreviewsForUser(deps.db, user.id)),
            };
          }),
        ),
      )
      .handle(
        'updateSettings',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            const decoded = Schema.decodeUnknownOption(ShowPreviewsBody, STRICT_DECODE)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'showPreviews must be a boolean');
            }
            if (!settingsLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many setting changes, try again later');
            }
            const showPreviews = yield* Effect.promise(() =>
              setShowPreviewsForUser(deps.db, user.id, decoded.value.showPreviews, new Date(now())),
            );
            return { showPreviews };
          }),
        ),
      )
      .handle(
        'test',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const { storageKey } = requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
            );
            const decoded = Schema.decodeUnknownOption(TestBody, STRICT_DECODE)(raw ?? {});
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'subscriptionId is required');
            }
            if (!testLimiter.allow(user.id)) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many test notifications, try again later',
              );
            }
            const devices = yield* Effect.promise(() => devicesForUser(deps.db, user.id));
            const target = devices.find((row) => row.id === decoded.value.subscriptionId);
            if (target === undefined) {
              throw new HttpError(404, 'not_found', 'Push device not found');
            }
            const cipher = createPushCipher(storageKey);
            const sender =
              deps.sender ??
              createWebPushSender({
                PUSH_VAPID_PUBLIC_KEY: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
                PUSH_VAPID_PRIVATE_KEY: deps.push.PUSH_VAPID_PRIVATE_KEY as string,
                PUSH_VAPID_SUBJECT: deps.push.PUSH_VAPID_SUBJECT as string,
              });
            let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
            try {
              subscription = {
                endpoint: target.endpoint,
                keys: { p256dh: cipher.decrypt(target.p256dh), auth: cipher.decrypt(target.auth) },
              };
            } catch {
              throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
            }
            // A send rejection surfaces as a defect, which `yield*` does not
            // throw into a surrounding `try`; map it to a value instead.
            const sendOutcome = yield* Effect.promise(() =>
              sender.send(
                subscription,
                JSON.stringify({
                  title: 'Zilar',
                  body: 'Push notifications work on this device.',
                }),
              ),
            ).pipe(
              Effect.map(() => ({ sent: true as const })),
              Effect.catchDefect((defect) => Effect.succeed({ sent: false as const, defect })),
            );
            if (!sendOutcome.sent) {
              const error = sendOutcome.defect;
              if (isExpiredSubscription(error)) {
                // Spec part 6: expired subscriptions are deleted. Scoped by id
                // AND userId like every other device delete, before answering
                // 410.
                yield* Effect.promise(() => removeDevice(deps.db, user.id, target.id));
                throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
              }
              // Like the component path: a failed send stamps `failed_at`, so
              // the device list and the 90-day rule see the failure.
              yield* Effect.promise(() => markDeviceFailed(deps.db, target.id, new Date(now())));
              throw new HttpError(502, 'push_failed', 'The test notification could not be sent');
            }
            // A successful test proves receipt, so it counts for the 90-day
            // inactivity rule like a real notification (N1).
            yield* Effect.promise(() => markDeviceUsed(deps.db, target.id, new Date(now())));
            return { sent: true };
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(PushApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(PushApi, apiLayer);
}
