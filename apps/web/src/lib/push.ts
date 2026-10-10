import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { runWeb } from '@/lib/effect/runtime';

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

// Registers the app service worker (idempotent: the browser returns the
// existing registration when already registered).
export function ensureServiceWorker(browser: PushBrowser): Promise<void> {
  return runWeb(ensureServiceWorkerEffect(browser));
}

const ensureServiceWorkerEffect = (browser: PushBrowser): Effect.Effect<void> =>
  Effect.promise(() => browser.serviceWorker.register('/sw.js')).pipe(Effect.asVoid);

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// The Promise API rejects with the browser's own error: a rejection from a
// browser promise is a defect here, so the caller still sees that error. The
// plain `Error`s below keep the class and message the API always rejected with.
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

// The app badge shows the total unread excluding muted chats, where the
// platform supports it. A zero count clears the badge; anything else is a
// no-op when the API is missing.
export function totalBadgeUnread(
  chats: ReadonlyArray<{ muted?: boolean; unread: number }>,
): number {
  return chats.reduce((sum, chat) => (chat.muted === true ? sum : sum + chat.unread), 0);
}
interface BadgeSurface {
  setAppBadge?: (count: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

// The pending badge call, or nothing when the surface lacks the method.
function badgeCall(surface: BadgeSurface, unread: number): Promise<void> | undefined {
  if (unread > 0 && surface.setAppBadge !== undefined) {
    return surface.setAppBadge(unread);
  }
  if (unread <= 0 && surface.clearAppBadge !== undefined) {
    return surface.clearAppBadge();
  }
  return undefined;
}

export function updateAppBadge(unread: number, navigatorSurface?: BadgeSurface): Promise<void> {
  return runWeb(updateAppBadgeEffect(unread, navigatorSurface));
}

const updateAppBadgeEffect = (
  unread: number,
  navigatorSurface?: BadgeSurface,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const surface = navigatorSurface ?? (typeof navigator === 'undefined' ? undefined : navigator);
    if (surface === undefined) {
      return Effect.void;
    }
    // Browsers may reject (e.g. permission revoked after install): the badge
    // is decoration, never load-bearing.
    return Effect.try(() => badgeCall(surface, unread)).pipe(
      Effect.flatMap((pending) =>
        pending === undefined ? Effect.void : Effect.tryPromise(() => pending),
      ),
      Effect.ignore,
    );
  });

// Dismisses the push notifications of a chat once it is read in the app.
// Tags are per-message (see the dismissal contract in `public/sw.js`), so
// this enumerates all visible notifications and closes the ones whose
// `data.chatId` matches — filtering by tag would miss every message-tagged
// notification in production.
export function dismissChatNotifications(
  chatId: string,
  getRegistration?: () => Promise<ServiceWorkerRegistrationLike | undefined>,
): Promise<void> {
  return runWeb(dismissChatNotificationsEffect(chatId, getRegistration));
}

type NotifyingRegistration = ServiceWorkerRegistrationLike &
  Required<Pick<ServiceWorkerRegistrationLike, 'getNotifications'>>;

const canListNotifications = (
  registration: ServiceWorkerRegistrationLike | undefined,
): registration is NotifyingRegistration => registration?.getNotifications !== undefined;

const dismissChatNotificationsEffect = Effect.fnUntraced(function* (
  chatId: string,
  getRegistration?: () => Promise<ServiceWorkerRegistrationLike | undefined>,
) {
  const pending: Promise<ServiceWorkerRegistrationLike | undefined> | undefined =
    getRegistration === undefined ? navigator.serviceWorker?.getRegistration() : getRegistration();
  const registration = pending === undefined ? undefined : yield* Effect.promise(() => pending);
  if (!canListNotifications(registration)) {
    return;
  }
  // Dismissal is best effort.
  yield* Effect.tryPromise(() => registration.getNotifications()).pipe(
    Effect.flatMap((notifications) =>
      Effect.try(() => {
        for (const notification of notifications) {
          if (notification.data?.chatId === chatId) {
            notification.close();
          }
        }
      }),
    ),
    Effect.ignore,
  );
});

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
