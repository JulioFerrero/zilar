import { beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { createWebPushSender, isExpiredSubscription, type VapidConfig } from './sender';

// The real `web-push` package talks to the push relays; the sender only needs
// its VAPID setup, `sendNotification` and the `WebPushError` class.
const mocks = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('web-push', () => {
  class WebPushError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    default: {
      setVapidDetails: mocks.setVapidDetails,
      sendNotification: mocks.sendNotification,
      WebPushError,
    },
  };
});

const config: VapidConfig = {
  PUSH_VAPID_PUBLIC_KEY: 'public-key',
  PUSH_VAPID_PRIVATE_KEY: 'private-key',
  PUSH_VAPID_SUBJECT: 'mailto:ops@example.com',
};

const subscription = {
  endpoint: 'https://push.example.com/device-1',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

function pushError(statusCode: number): Error {
  return new webpush.WebPushError(
    `push failed with ${statusCode}`,
    statusCode,
    {},
    '',
    subscription.endpoint,
  );
}

describe('createWebPushSender', () => {
  beforeEach(() => {
    mocks.setVapidDetails.mockReset();
    mocks.sendNotification.mockReset();
  });

  it('refuses to build without all three VAPID settings', () => {
    expect(() => createWebPushSender({ ...config, PUSH_VAPID_PRIVATE_KEY: undefined })).toThrow(
      'push sender needs PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT',
    );
    expect(mocks.setVapidDetails).not.toHaveBeenCalled();
  });

  it('sets the VAPID details and resolves not gone when the send succeeds', async () => {
    mocks.sendNotification.mockResolvedValue(undefined);
    const sender = createWebPushSender(config);

    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      'mailto:ops@example.com',
      'public-key',
      'private-key',
    );
    await expect(sender.send(subscription, '{"body":"hi"}')).resolves.toEqual({ gone: false });
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: 'https://push.example.com/device-1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
      },
      '{"body":"hi"}',
      { TTL: 24 * 3600, urgency: 'normal' },
    );
  });

  it.each([404, 410])('resolves gone for an expired subscription (%i)', async (statusCode) => {
    mocks.sendNotification.mockRejectedValue(pushError(statusCode));
    const sender = createWebPushSender(config);

    await expect(sender.send(subscription, 'payload')).resolves.toEqual({ gone: true });
  });

  it('rethrows the original error for any other failure', async () => {
    const serverError = pushError(500);
    mocks.sendNotification.mockRejectedValueOnce(serverError);
    const sender = createWebPushSender(config);

    await expect(sender.send(subscription, 'payload')).rejects.toBe(serverError);

    const networkError = new Error('socket hang up');
    mocks.sendNotification.mockRejectedValueOnce(networkError);
    await expect(sender.send(subscription, 'payload')).rejects.toBe(networkError);
  });
});

describe('isExpiredSubscription', () => {
  it('is true for 404 and 410 on a WebPushError and on a plain status object', () => {
    expect(isExpiredSubscription(pushError(404))).toBe(true);
    expect(isExpiredSubscription(pushError(410))).toBe(true);
    expect(isExpiredSubscription({ statusCode: 410 })).toBe(true);
  });

  it('is false for other statuses and for errors without a status', () => {
    expect(isExpiredSubscription(pushError(500))).toBe(false);
    expect(isExpiredSubscription({ statusCode: 429 })).toBe(false);
    expect(isExpiredSubscription(new Error('no status'))).toBe(false);
  });
});
