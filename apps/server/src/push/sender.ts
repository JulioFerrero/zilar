import { Effect } from 'effect';
import webpush from 'web-push';
import { isAllowedPushEndpoint } from '@zilar/api-contract';

export type WebPushDelivery = {
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<{ gone: boolean }>;
};

export interface VapidConfig {
  PUSH_VAPID_PUBLIC_KEY: string | undefined;
  PUSH_VAPID_PRIVATE_KEY: string | undefined;
  PUSH_VAPID_SUBJECT: string | undefined;
}

// Real Web Push sender (VAPID + RFC 8291 via `web-push`); the relay only
// sees ciphertext. A 404/410 means the subscription expired and the caller
// must drop it. Keys are optional in the type because the sender is built
// from the raw config; missing keys throw after the `pushConfigError` gate.
export function createWebPushSender(config: VapidConfig): WebPushDelivery {
  if (
    config.PUSH_VAPID_PUBLIC_KEY === undefined ||
    config.PUSH_VAPID_PRIVATE_KEY === undefined ||
    config.PUSH_VAPID_SUBJECT === undefined
  ) {
    throw new Error('push sender needs PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT');
  }
  webpush.setVapidDetails(
    config.PUSH_VAPID_SUBJECT,
    config.PUSH_VAPID_PUBLIC_KEY,
    config.PUSH_VAPID_PRIVATE_KEY,
  );
  return {
    send: (subscription, payload) => Effect.runPromise(sendEffect(subscription, payload)),
  };
}

// One Web Push send; a rejection stays a defect so the caller rejects with
// the original error, while an expired subscription is a value.
function sendEffect(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Effect.Effect<{ gone: boolean }> {
  // Never dial a row stored before the endpoint allowlist: report it as
  // expired so the caller drops it, and make no request at all.
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return Effect.succeed({ gone: true });
  }
  return Effect.promise(() =>
    webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      },
      payload,
      { TTL: 24 * 3600, urgency: 'normal', timeout: 10_000 },
    ),
  ).pipe(
    Effect.as({ gone: false }),
    Effect.catchDefect((error) =>
      isExpiredSubscription(error) ? Effect.succeed({ gone: true }) : Effect.die(error),
    ),
  );
}

export function isExpiredSubscription(error: unknown): boolean {
  if (error instanceof webpush.WebPushError) {
    return error.statusCode === 404 || error.statusCode === 410;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}
