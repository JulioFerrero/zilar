import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { runWeb } from '@/lib/effect/runtime';

// Everything here only touches browser APIs, read through narrow injectable surfaces for tests.

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
        runWeb(
          Effect.promise(() => navigator.serviceWorker.register(script)).pipe(
            Effect.map((registration) => ({ pushManager: registration.pushManager })),
          ),
        ),
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

// Registers the app service worker; the browser returns the existing registration if already registered.
export function ensureServiceWorker(browser: PushBrowser): Promise<void> {
  return runWeb(ensureServiceWorkerEffect(browser));
}

const ensureServiceWorkerEffect = (browser: PushBrowser): Effect.Effect<void> =>
  Effect.promise(() => browser.serviceWorker.register('/sw.js')).pipe(Effect.asVoid);

/** True once a new deploy's service worker has taken over this page: the page keeps running
 * the old bundle, so the caller shows the reload banner. A first install claims this page
 * too, so a page with no previous controller never counts as an update. */
export function useServiceWorkerUpdate(): boolean {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    // Only a page that was already controlled can be updated by a new worker.
    if (navigator.serviceWorker.controller === null) {
      return;
    }
    const onControllerChange = (): void => {
      setUpdated(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);
  return updated;
}

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// A browser promise's rejection is a defect, so the caller sees that error; plain Errors keep
// their class and message.
const existingSubscription = (
  registration: { pushManager: PushManagerLike } | undefined,
): Effect.Effect<PushSubscriptionLike | null | undefined> =>
  registration === undefined
    ? Effect.succeed(undefined)
    : Effect.promise(() => registration.pushManager.getSubscription());

export function subscribeBrowser(
  browser: PushBrowser,
  vapidPublicKey: string,
): Promise<{ subscription: DeviceSubscription; label: string }> {
  return runWeb(subscribeBrowserEffect(browser, vapidPublicKey));
}

const subscribeBrowserEffect = Effect.fnUntraced(function* (
  browser: PushBrowser,
  vapidPublicKey: string,
): Effect.fn.Return<{ subscription: DeviceSubscription; label: string }, Error> {
  const permission = yield* Effect.promise(() => browser.Notification.requestPermission());
  if (permission !== 'granted') {
    return yield* Effect.fail(new Error(`notification permission ${permission}`));
  }
  yield* ensureServiceWorkerEffect(browser);
  const registration = yield* Effect.promise(() => browser.serviceWorker.getRegistration());
  if (registration === undefined) {
    return yield* Effect.fail(new Error('no service worker registration'));
  }
  let subscription = yield* Effect.promise(() => registration.pushManager.getSubscription());
  if (subscription === null) {
    subscription = yield* Effect.promise(() =>
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }),
    );
  }
  return {
    subscription: { endpoint: subscription.endpoint, ...(yield* subscriptionKeys(subscription)) },
    label: deviceLabel(),
  };
});

function subscriptionKeys(subscription: PushSubscriptionLike): Effect.Effect<
  {
    keys: { p256dh: string; auth: string };
  },
  Error
> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (p256dh === undefined || auth === undefined) {
    return Effect.fail(new Error('the browser subscription has no keys'));
  }
  return Effect.succeed({ keys: { p256dh, auth } });
}

export function unsubscribeBrowser(browser: PushBrowser): Promise<void> {
  return runWeb(unsubscribeBrowserEffect(browser));
}

const unsubscribeBrowserEffect = Effect.fnUntraced(function* (browser: PushBrowser) {
  const registration = yield* Effect.promise(() => browser.serviceWorker.getRegistration());
  const subscription = yield* existingSubscription(registration);
  if (subscription !== undefined && subscription !== null) {
    yield* Effect.promise(() => subscription.unsubscribe());
  }
});

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

export { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from './push/badge';

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
  return Effect.runSync(
    Effect.try(() => env.matchMedia?.('(display-mode: standalone)')?.matches === true).pipe(
      Effect.orElseSucceed(() => false),
    ),
  );
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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
    promptInstall: () =>
      runWeb(
        Effect.gen(function* () {
          if (installEvent !== null) {
            yield* Effect.promise(() => installEvent.prompt());
          }
          setInstallEvent(null);
        }),
      ),
  };
}
