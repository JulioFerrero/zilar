import { Effect, Option, Schema } from 'effect';
import type { Logger } from 'pino';
import { PushTestPayload } from '@zilar/api-contract';
import { handler } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { createPushCipher } from './crypto';
import { type FcmSender, FcmSendError } from './fcm';
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

// The column cap (migration 0054's check); every reason here is already
// short, and the slice guards a future transport.
const PUSH_FAILURE_REASON_MAX_LENGTH = 64;

/** The short reason stored when a send fails: an FCM rejection keeps its
 * error code or falls back to `http-<status>`, a Web Push rejection its HTTP
 * status. The registration token, access token and request body never reach
 * this string. */
function pushFailureReason(error: unknown): string {
  return rawReason(error).slice(0, PUSH_FAILURE_REASON_MAX_LENGTH);
}

function rawReason(error: unknown): string {
  if (error instanceof FcmSendError) {
    return error.code ?? `http-${error.status}`;
  }
  const status = statusCodeOf(error);
  return status === null ? 'unknown' : `http-${status}`;
}

// Web Push rejects with `webpush.WebPushError`, which carries `statusCode`;
// matching it structurally keeps this module independent of the package.
function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}
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
      if (target.token !== null) {
        if (nativeSender === undefined) {
          throw new HttpError(
            503,
            'push_unavailable',
            'Push notifications are not configured for this device',
          );
        }
        const native = openNativeDevice(target);
        // A send rejection surfaces as a defect, which `yield*` does not throw
        // into a surrounding `try`; map it to a value. `gone` is a value, and
        // `failed_at` is stamped only for a real failure.
        const nativeOutcome = yield* Effect.promise(() =>
          nativeSender.send(native.token, {
            chatId: TEST_WAKE_CHAT_ID,
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
          // A failed send stamps `failed_at` and its reason, and the route answers
          // `push_failed`.
          yield* Effect.promise(() =>
            markDeviceFailed(deps.db, target.id, new Date(now()), nativeOutcome.reason),
          );
          throw new HttpError(502, 'push_failed', 'The test notification could not be sent');
        }
        if (nativeOutcome.gone) {
          yield* Effect.promise(() => removeDevice(deps.db, user.id, target.id));
          throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
        }
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
          // Expired subscriptions are deleted, scoped by id AND userId before
          // answering 410.
          yield* Effect.promise(() => removeDevice(deps.db, user.id, target.id));
          throw new HttpError(410, 'device_gone', 'The push device is no longer usable');
        }
        yield* Effect.promise(() =>
          markDeviceFailed(deps.db, target.id, new Date(now()), pushFailureReason(error)),
        );
        throw new HttpError(502, 'push_failed', 'The test notification could not be sent');
      }
      yield* Effect.promise(() => markDeviceUsed(deps.db, target.id, new Date(now())));
      return { sent: true };
    }),
  );
}
