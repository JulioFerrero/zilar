// The push test-notification handler, split out of `./api-handlers` by T-1565
// (size split). Moved unchanged: requirePush, then the body decode, then the
// test limiter, then the per-device send; the native (FCM) and Web Push paths
// keep their statuses, texts and step order. Ids only ever reach the logs,
// never the token or the sealed keys.

import { Effect, Option, Schema } from 'effect';
import type { Logger } from 'pino';
import { PushTestPayload } from '@zilar/api-contract';
import { handler } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { createPushCipher } from './crypto';
import { pushFailureReason } from './failure-reason';
import type { FcmSender } from './fcm';
import { createWebPushSender, isExpiredSubscription } from './sender';
import {
  devicesForUser,
  markDeviceFailed,
  markDeviceUsed,
  openNativeDevice,
  removeDevice,
} from './store';
import { STRICT_DECODE, TEST_WAKE_CHAT_ID, createRequirePush } from './api-util';
import type { PushApiDependencies } from './api';

export function createTestHandler(
  deps: PushApiDependencies,
  limiter: RateLimiter,
  nativeSender: FcmSender | undefined,
  now: () => number,
  logger: Logger,
) {
  const requirePush = createRequirePush(deps);
  return handler(logger, (request, user) =>
    Effect.gen(function* () {
      const { storageKey } = requirePush();
      const raw = yield* request.request.json.pipe(
        Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
      );
      const decoded = Schema.decodeUnknownOption(PushTestPayload, STRICT_DECODE)(raw ?? {});
      if (Option.isNone(decoded)) {
        throw new HttpError(400, 'invalid_request', 'subscriptionId is required');
      }
      if (!limiter.allow(user.id)) {
        throw new HttpError(429, 'rate_limited', 'Too many test notifications, try again later');
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
  );
}
