import webpush from 'web-push';
import type { PushSpikeConfig } from './spike-config';

export type WebPushDelivery = {
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<{ gone: boolean }>;
};

// Real Web Push sender (VAPID + RFC 8291 encryption via the `web-push`
// package). Payloads are encrypted end-to-end between our server and the
// browser: the push relay (Google/Mozilla/Apple) only sees ciphertext.
// A 404/410 from the endpoint means the subscription expired and the
// caller must drop it.
export function createWebPushSender(config: PushSpikeConfig): WebPushDelivery {
  if (
    config.PUSH_VAPID_PUBLIC_KEY === undefined ||
    config.PUSH_VAPID_PRIVATE_KEY === undefined ||
    config.PUSH_VAPID_SUBJECT === undefined
  ) {
    throw new Error('push spike sender needs PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT');
  }
  webpush.setVapidDetails(
    config.PUSH_VAPID_SUBJECT,
    config.PUSH_VAPID_PUBLIC_KEY,
    config.PUSH_VAPID_PRIVATE_KEY,
  );
  return {
    send: async (subscription, payload) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          payload,
          { TTL: 24 * 3600, urgency: 'normal' },
        );
        return { gone: false };
      } catch (error) {
        if (isExpiredSubscription(error)) {
          return { gone: true };
        }
        throw error;
      }
    },
  };
}

export function isExpiredSubscription(error: unknown): boolean {
  if (error instanceof webpush.WebPushError) {
    return error.statusCode === 404 || error.statusCode === 410;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}
