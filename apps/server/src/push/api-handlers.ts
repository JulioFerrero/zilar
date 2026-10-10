// The push API handlers and their group layer, split out of `./api` by T-1017
// (size split). Moved unchanged: config, list, remove, settings, updateSettings
// and test keep their order, statuses and texts; the subscribe route is built
// in `./api-subscribe`, and the shared helpers live in `./api-util`.

import { Effect, Option, Schema } from 'effect';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import { PushGroup, PushSettingsPayload, PushTestPayload } from '@zilar/api-contract';
import { handler } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import { createPushCipher } from './crypto';
import { createWebPushSender, isExpiredSubscription } from './sender';
import {
  devicesForUser,
  markDeviceFailed,
  markDeviceUsed,
  removeDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';
import { STRICT_DECODE, createRequirePush, errorName } from './api-util';
import { createSubscribeHandler } from './api-subscribe';
import type { PushApiDependencies } from './api';

export function createPushGroupLayer(
  api: HttpApi.HttpApi<'push', typeof PushGroup>,
  deps: PushApiDependencies,
  limiters: { subscribe: RateLimiter; settings: RateLimiter; test: RateLimiter },
) {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const requirePush = createRequirePush(deps);

  return HttpApiBuilder.group(api, 'push', (handlers) =>
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
      .handleRaw('subscribe', createSubscribeHandler(deps, limiters.subscribe, requirePush))
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
            if (!limiters.subscribe.allow(user.id)) {
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
      .handleRaw(
        'updateSettings',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            const decoded = Schema.decodeUnknownOption(PushSettingsPayload, STRICT_DECODE)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'showPreviews must be a boolean');
            }
            if (!limiters.settings.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many setting changes, try again later');
            }
            const showPreviews = yield* Effect.promise(() =>
              setShowPreviewsForUser(deps.db, user.id, decoded.value.showPreviews, new Date(now())),
            );
            return { showPreviews };
          }),
        ),
      )
      .handleRaw(
        'test',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const { storageKey } = requirePush();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
            );
            const decoded = Schema.decodeUnknownOption(PushTestPayload, STRICT_DECODE)(raw ?? {});
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'subscriptionId is required');
            }
            if (!limiters.test.allow(user.id)) {
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
}
