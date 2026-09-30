import { useEffect, useState } from 'react';

// Browser side of web push (T-0119): PushManager subscription, permission
// states, the install prompt, the app badge and notification dismissal.
// Server calls live in `lib/api.ts`; everything here only touches browser
// APIs, read through narrow injectable surfaces so the tests run with fakes.

export type PushSupport = 'supported' | 'unsupported';

export function pushSupport(env: { serviceWorker?: unknown; PushManager?: unknown }): PushSupport {
  return env.serviceWorker !== undefined && env.PushManager !== undefined
    ? 'supported'
    : 'unsupported';
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export function permissionStateOf(env: {
  Notification?: { permission?: unknown } | undefined;
}): NotificationPermissionState | 'unsupported' {
  const permission = env.Notification?.permission;
  return permission === 'granted' || permission === 'denied' || permission === 'default'
    ? permission
    : 'unsupported';
}

// The VAPID key is url-safe base64; PushManager wants the raw bytes.
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export interface PushBrowser {
  serviceWorker: {
    register: (script: string) => Promise<{ pushManager: PushManagerLike }>;
    getRegistration: () => Promise<ServiceWorkerRegistrationLike | undefined>;
  };
  Notification: {
    permission: NotificationPermissionState;
    requestPermission: () => Promise<NotificationPermissionState>;
  };
}

export interface PushManagerLike {
  getSubscription: () => Promise<PushSubscriptionLike | null>;
  subscribe: (options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }) => Promise<PushSubscriptionLike>;
}

export interface PushSubscriptionLike {
  endpoint: string;
  toJSON: () => { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  unsubscribe: () => Promise<boolean>;
}

export interface ServiceWorkerRegistrationLike {
  pushManager: PushManagerLike;
  getNotifications?: (filter?: { tag?: string }) => Promise<
    Array<{
      close: () => void;
      data?: { chatId?: string } | null;
    }>
  >;
}

export function realPushBrowser(): PushBrowser | undefined {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof Notification === 'undefined' ||
    !('PushManager' in window)
  ) {
    return undefined;
  }
  return {
    serviceWorker: {
      register: (script) =>
        navigator.serviceWorker.register(script).then((registration) => ({
          pushManager: registration.pushManager,
        })),
      getRegistration: () => navigator.serviceWorker.getRegistration(),
    },
    Notification: {
      get permission(): NotificationPermissionState {
        const value = Notification.permission;
        return value === 'granted' || value === 'denied' ? value : 'default';
      },
      requestPermission: () => Notification.requestPermission(),
    },
  };
}

// Registers the app service worker (idempotent: the browser returns the
// existing registration when already registered).
export async function ensureServiceWorker(browser: PushBrowser): Promise<void> {
  await browser.serviceWorker.register('/sw.js');
}

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function currentSubscription(
  browser: PushBrowser,
): Promise<DeviceSubscription | null> {
  const registration = await browser.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription === undefined || subscription === null) {
    return null;
  }
  return { endpoint: subscription.endpoint, ...subscriptionKeys(subscription) };
}

export async function subscribeBrowser(
  browser: PushBrowser,
  vapidPublicKey: string,
): Promise<{ subscription: DeviceSubscription; label: string }> {
  const permission = await browser.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(`notification permission ${permission}`);
  }
  await ensureServiceWorker(browser);
  const registration = await browser.serviceWorker.getRegistration();
  if (registration === undefined) {
    throw new Error('no service worker registration');
  }
  let subscription = await registration.pushManager.getSubscription();
  if (subscription === null) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  return {
    subscription: { endpoint: subscription.endpoint, ...subscriptionKeys(subscription) },
    label: deviceLabel(),
  };
}

function subscriptionKeys(subscription: PushSubscriptionLike): {
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (p256dh === undefined || auth === undefined) {
    throw new Error('the browser subscription has no keys');
  }
  return { keys: { p256dh, auth } };
}

export async function unsubscribeBrowser(browser: PushBrowser): Promise<void> {
  const registration = await browser.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

// A short human label for the device list, from the user agent only.
export function deviceLabel(userAgent?: string): string {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const os = /Android/i.test(agent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(agent)
      ? 'iOS'
      : /Mac/i.test(agent)
        ? 'Mac'
        : /Windows/i.test(agent)
          ? 'Windows'
          : /Linux/i.test(agent)
            ? 'Linux'
            : 'Unknown device';
  const browser = /Edg\//i.test(agent)
    ? 'Edge'
    : /Chrome\//i.test(agent)
      ? 'Chrome'
      : /Safari\//i.test(agent)
        ? 'Safari'
        : /Firefox\//i.test(agent)
          ? 'Firefox'
          : 'Browser';
  return `${os} · ${browser}`;
}

// The app badge shows the total unread excluding muted chats, where the
// platform supports it. A zero count clears the badge; anything else is a
// no-op when the API is missing.
export function totalBadgeUnread(
  chats: ReadonlyArray<{ muted?: boolean; unread: number }>,
): number {
  return chats.reduce((sum, chat) => (chat.muted === true ? sum : sum + chat.unread), 0);
}
export async function updateAppBadge(
  unread: number,
  navigatorSurface?: {
    setAppBadge?: (count: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  },
): Promise<void> {
  const surface = navigatorSurface ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (surface === undefined) {
    return;
  }
  try {
    if (unread > 0 && surface.setAppBadge !== undefined) {
      await surface.setAppBadge(unread);
    } else if (unread <= 0 && surface.clearAppBadge !== undefined) {
      await surface.clearAppBadge();
    }
  } catch {
    // Browsers may reject (e.g. permission revoked after install): the badge
    // is decoration, never load-bearing.
  }
}

// Dismisses the push notifications of a chat once it is read in the app.
// Tags are per-message (see the dismissal contract in `public/sw.js`), so
// this enumerates all visible notifications and closes the ones whose
// `data.chatId` matches — filtering by tag would miss every message-tagged
// notification in production.
export async function dismissChatNotifications(
  chatId: string,
  getRegistration?: () => Promise<ServiceWorkerRegistrationLike | undefined>,
): Promise<void> {
  const registration =
    getRegistration === undefined
      ? await navigator.serviceWorker?.getRegistration()
      : await getRegistration();
  if (registration?.getNotifications === undefined) {
    return;
  }
  try {
    const notifications = await registration.getNotifications();
    for (const notification of notifications) {
      if (notification.data?.chatId === chatId) {
        notification.close();
      }
    }
  } catch {
    // Dismissal is best effort.
  }
}

// --- Install prompt ---------------------------------------------------------

export function isIosDevice(userAgent?: string): boolean {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return /iPhone|iPad|iPod/i.test(agent);
}

export function isStandaloneDisplay(env: {
  matchMedia?: (query: string) => { matches: boolean };
  standalone?: unknown;
}): boolean {
  if (env.standalone === true) {
    return true;
  }
  try {
    return env.matchMedia?.('(display-mode: standalone)')?.matches === true;
  } catch {
    return false;
  }
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captures the browser's install offer for the main menu's Install entry.
// Returns the captured event for the current render plus a prompt function.
export function useInstallPrompt(): {
  installEvent: BeforeInstallPromptEvent | null;
  promptInstall: () => Promise<void>;
} {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const handler = (event: Event): void => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  return {
    installEvent,
    promptInstall: async () => {
      await installEvent?.prompt();
      setInstallEvent(null);
    },
  };
}
