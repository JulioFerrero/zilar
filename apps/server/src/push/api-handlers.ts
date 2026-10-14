// The push API handlers and their group layer, split out of `./api` by T-1017
// (size split). Moved unchanged: config, list, remove, settings, updateSettings
// and test keep their order, statuses and texts; the subscribe route is built
// in `./api-subscribe`, and the shared helpers live in `./api-util`.

import { Effect, Option, Schema } from 'effect';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import { PushGroup, PushSettingsPayload, PushTestPayload } from '@zilar/api-contract';
import { errorClassName } from '../effect/error-utils';
import { handler } from '../effect/http-core';
import { HttpError, xmppUnavailable } from '../errors';
import { cardEditTarget, isLiveAiUiRow } from '../notify/ai-cards';
import type { RateLimiter } from '../rate-limit';
import { cachedAllowedArchives } from './archives-cache';
import { syncPushSubscriptionsForUser } from '../topics/rooms';
import { readCandidateByOriginId } from './archive-scan';
import { resolveCandidate } from './candidates';
import { createPushCipher } from './crypto';
import { pushFailureReason } from './failure-reason';
import type { FcmSender } from './fcm';
import { createNativeSender } from './native-sender';
import { buildPushPayload } from './payload';
import { createWebPushSender, isExpiredSubscription } from './sender';
import {
  devicesForUser,
  markDeviceFailed,
  markDeviceUsed,
  openNativeDevice,
  removeDevice,
  setShowPreviewsForUser,
  showPreviewsForUser,
  toPushDeviceView,
} from './store';
import { STRICT_DECODE, createRequirePush } from './api-util';
import { createSubscribeHandler } from './api-subscribe';
import { forkPreviewDelivered } from './preview-delivered';
import type { PushApiDependencies } from './api';

// The test wake's chat id, shared with the mobile handler: the data-only
// FCM wake `{ chatId: 'zilar:test', serverId }` draws the fixed "Push
// notifications work on this device." text on the phone.
export const TEST_WAKE_CHAT_ID = 'zilar:test';

export function createPushGroupLayer(
  api: HttpApi.HttpApi<'push', typeof PushGroup>,
  deps: PushApiDependencies,
  limiters: {
    subscribe: RateLimiter;
    settings: RateLimiter;
    test: RateLimiter;
    preview: RateLimiter;
  },
) {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const requirePush = createRequirePush(deps);
  // The native sender for the test route: injected in tests, otherwise built
  // once here from the push config (undefined without the FCM config).
  const nativeSender: FcmSender | undefined =
    deps.nativeSender ?? createNativeSender(deps.push, logger);

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
                      { userId: user.id, err: errorClassName(defect) },
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
        'preview',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            if (!limiters.preview.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many preview lookups, try again later');
            }
            const archive = deps.archive;
            if (archive === undefined) {
              throw xmppUnavailable();
            }
            const userId = user.id;
            // A failed archive read is a defect (`orDie`) so the shared error
            // envelope renders it, exactly like the search route.
            const allowed = yield* Effect.tryPromise({
              try: () => cachedAllowedArchives(deps.db, deps.config, userId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            const row = yield* Effect.tryPromise({
              try: () => readCandidateByOriginId(archive, allowed, request.query.messageId),
              catch: () => xmppUnavailable(),
            }).pipe(Effect.orDie);
            // An unknown id and a message in a chat the caller may not see both
            // match no row; muted, hidden and skipped rows also answer the same
            // 404, so the route never reveals whether a message exists.
            if (row === undefined) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The live AI UI is not a message (T-1400): skip the card and an
            // edit of one, so an AI progress card's text is never previewed.
            const editTarget = cardEditTarget(row.xml);
            const liveIds = new Set<string>();
            if (editTarget !== null) {
              const targetRow = yield* Effect.tryPromise({
                try: () => readCandidateByOriginId(archive, allowed, editTarget),
                catch: () => xmppUnavailable(),
              }).pipe(Effect.orDie);
              if (targetRow !== undefined && isLiveAiUiRow(targetRow.xml)) liveIds.add(editTarget);
            }
            const verdict = yield* Effect.promise(() =>
              resolveCandidate(
                { db: deps.db, config: deps.config, now: () => new Date(now()) },
                userId,
                allowed,
                row,
                liveIds,
              ),
            );
            if (verdict.status !== 'ok') {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // The preview proves this device received the message, so mark it
            // delivered. Off the HTTP path and error-swallowed, so the answer
            // never waits on the mark and never fails with it. Only an `ok`
            // verdict marks: an unknown id, a message in a chat the caller may
            // not see, and a muted or hidden chat all answer 404 above and mark
            // nothing; the test wake marks nothing either.
            if (verdict.message.chatJid !== TEST_WAKE_CHAT_ID) {
              forkPreviewDelivered(deps, {
                chatJid: verdict.message.chatJid,
                userId,
                messageId: request.query.messageId,
              });
            }
            const showPreviews = yield* Effect.promise(() => showPreviewsForUser(deps.db, userId));
            const payload = buildPushPayload(verdict.message, {
              muted: false,
              visible: true,
              showPreviews,
            });
            if (payload === undefined) {
              throw new HttpError(404, 'not_found', 'Notification not found');
            }
            // Ids only: the derived text is returned, never logged.
            return {
              title: payload.title,
              body: payload.body,
              chatId: verdict.message.chatJid,
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
            // A native row speaks FCM, not Web Push: it carries the plaintext
            // device token instead of the sealed endpoint and keys.
            if (target.token !== null) {
              if (nativeSender === undefined) {
                throw new HttpError(
                  503,
                  'push_unavailable',
                  'Push notifications are not configured for this device',
                );
              }
              const native = openNativeDevice(target);
              // A send rejection surfaces as a defect, which `yield*` does
              // not throw into a surrounding `try`; map it to a value instead.
              // `gone` is a value, not a throw: keep it, and stamp `failed_at`
              // only for a real failure, like the Web Push path below.
              const nativeOutcome = yield* Effect.promise(() =>
                nativeSender.send(native.token, {
                  chatId: TEST_WAKE_CHAT_ID,
                  // The synthetic test wake is not a real chat: `group` is the
                  // kind the phone's test post used before it carried one, and
                  // the phone ignores the kind for a test wake anyway.
                  chatKind: 'group',
                  serverId: deps.config.xmpp.domain,
                }),
              ).pipe(
                Effect.map((result) => ({ sent: true as const, gone: result.gone, reason: '' })),
                Effect.catchDefect((defect) =>
                  Effect.succeed({
                    sent: false as const,
                    gone: false,
                    reason: pushFailureReason(defect),
                  }),
                ),
              );
              if (!nativeOutcome.sent) {
                // Like the Web Push failure path: a failed send stamps
                // `failed_at` and its reason, and the route answers
                // `push_failed`.
                yield* Effect.promise(() =>
                  markDeviceFailed(deps.db, target.id, new Date(now()), nativeOutcome.reason),
                );
                throw new HttpError(502, 'push_failed', 'The test notification could not be sent');
              }
              if (nativeOutcome.gone) {
                // The token is dead: remove the row (scoped by id AND userId,
                // like the Web Push expired path) before answering 410.
                yield* Effect.promise(() => removeDevice(deps.db, user.id, target.id));
                throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
              }
              // A successful test proves receipt, so it counts for the 90-day
              // inactivity rule like a real notification (N1).
              yield* Effect.promise(() => markDeviceUsed(deps.db, target.id, new Date(now())));
              return { sent: true };
            }
            const sender =
              deps.sender ??
              createWebPushSender({
                PUSH_VAPID_PUBLIC_KEY: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
                PUSH_VAPID_PRIVATE_KEY: deps.push.PUSH_VAPID_PRIVATE_KEY as string,
                PUSH_VAPID_SUBJECT: deps.push.PUSH_VAPID_SUBJECT as string,
              });
            let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
            try {
              // A native row has no Web Push endpoint or keys: it cannot take a
              // Web Push test, and answers the same 410 as a row that no longer
              // decrypts.
              if (target.endpoint === null || target.p256dh === null || target.auth === null) {
                throw new Error('The push device is not a Web Push device');
              }
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
              // Like the component path: a failed send stamps `failed_at` and
              // its short reason, so the device list and the 90-day rule see
              // the failure.
              yield* Effect.promise(() =>
                markDeviceFailed(deps.db, target.id, new Date(now()), pushFailureReason(error)),
              );
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
