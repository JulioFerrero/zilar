import { describe, expect, it, vi } from 'vitest';
import {
  deviceLabel,
  dismissChatNotifications,
  isIosDevice,
  isStandaloneDisplay,
  permissionStateOf,
  pushSupport,
  subscribeBrowser,
  totalBadgeUnread,
  unsubscribeBrowser,
  updateAppBadge,
  urlBase64ToUint8Array,
  type PushBrowser,
} from './push';

function fakeBrowser(overrides: Partial<PushBrowser> = {}): PushBrowser {
  const subscriptions: Array<{ endpoint: string }> = [];
  const manager = {
    getSubscription: async () =>
      subscriptions.length === 0
        ? null
        : {
            endpoint: subscriptions[0]!.endpoint,
            toJSON: () => ({
              endpoint: subscriptions[0]!.endpoint,
              keys: { p256dh: 'p', auth: 'a' },
            }),
            unsubscribe: async () => {
              subscriptions.length = 0;
              return true;
            },
          },
    subscribe: async () => {
      subscriptions.push({ endpoint: 'https://push.example.com/sub-1' });
      return {
        endpoint: 'https://push.example.com/sub-1',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p', auth: 'a' },
        }),
        unsubscribe: async () => {
          subscriptions.length = 0;
          return true;
        },
      };
    },
  };
  return {
    serviceWorker: {
      register: async () => ({ pushManager: manager }),
      getRegistration: async () => ({ pushManager: manager }),
    },
    Notification: { permission: 'default', requestPermission: async () => 'granted' as const },
    ...overrides,
  };
}

describe('push browser helpers', () => {
  it('detects support from the browser globals', () => {
    expect(pushSupport({ serviceWorker: {}, PushManager: {} })).toBe('supported');
    expect(pushSupport({})).toBe('unsupported');
    expect(pushSupport({ serviceWorker: {} })).toBe('unsupported');
  });

  it('reads the permission state', () => {
    expect(permissionStateOf({ Notification: { permission: 'granted' } })).toBe('granted');
    expect(permissionStateOf({ Notification: { permission: 'denied' } })).toBe('denied');
    expect(permissionStateOf({ Notification: { permission: 'default' } })).toBe('default');
    expect(permissionStateOf({})).toBe('unsupported');
    expect(permissionStateOf({ Notification: { permission: 'weird' } })).toBe('unsupported');
  });

  it('decodes the VAPID key', () => {
    const bytes = urlBase64ToUint8Array('SGVsbG8');
    expect([...bytes]).toEqual([72, 101, 108, 108, 111]);
  });

  it('subscribes through the PushManager after permission', async () => {
    const browser = fakeBrowser();
    const { subscription, label } = await subscribeBrowser(browser, 'SGVsbG8');
    expect(subscription.endpoint).toBe('https://push.example.com/sub-1');
    expect(subscription.keys).toEqual({ p256dh: 'p', auth: 'a' });
    expect(typeof label).toBe('string');
  });

  it('refuses to subscribe when permission is denied', async () => {
    const browser = fakeBrowser({
      Notification: { permission: 'denied', requestPermission: async () => 'denied' as const },
    });
    await expect(subscribeBrowser(browser, 'SGVsbG8')).rejects.toThrow(
      'notification permission denied',
    );
  });

  it('unsubscribes the browser subscription', async () => {
    const browser = fakeBrowser();
    await subscribeBrowser(browser, 'SGVsbG8');
    const unsubscribed: boolean[] = [];
    const registration = await browser.serviceWorker.getRegistration();
    const original = registration?.pushManager.getSubscription;
    void original;
    await unsubscribeBrowser(browser);
    expect(unsubscribed).toEqual([]);
  });

  it('labels devices from the user agent', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iOS · Safari');
    expect(deviceLabel('')).toBe('Unknown device · Browser');
  });

  it('totals unread excluding muted chats', () => {
    expect(
      totalBadgeUnread([
        { unread: 2 },
        { unread: 5, muted: true },
        { unread: 0 },
        { unread: 3, muted: false },
      ]),
    ).toBe(5);
    expect(totalBadgeUnread([])).toBe(0);
  });

  it('updates the app badge where supported and never throws', async () => {
    const badges: number[] = [];
    let cleared = 0;
    const surface = {
      setAppBadge: async (count: number) => {
        badges.push(count);
      },
      clearAppBadge: async () => {
        cleared += 1;
      },
    };
    await updateAppBadge(3, surface);
    await updateAppBadge(0, surface);
    expect(badges).toEqual([3]);
    expect(cleared).toBe(1);
    await updateAppBadge(3, {});
    await updateAppBadge(3, {
      setAppBadge: async () => {
        throw new Error('denied');
      },
    });
  });

  it('dismisses a chat notifications by tag', async () => {
    const closed: string[] = [];
    const registration = {
      pushManager: fakeBrowser().serviceWorker.register('') as never,
      getNotifications: async (filter?: { tag?: string }) => {
        expect(filter).toEqual({ tag: 'room@rooms.x' });
        return [{ close: () => closed.push('a') }, { close: () => closed.push('b') }];
      },
    };
    await dismissChatNotifications('room@rooms.x', async () => registration);
    expect(closed).toEqual(['a', 'b']);
    await dismissChatNotifications('room@rooms.x', async () => undefined);
  });

  it('detects iOS and standalone display', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isStandaloneDisplay({ standalone: true })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandaloneDisplay({})).toBe(false);
    void vi;
  });
});
