// The app badge and notification dismissal half of the browser push code
// (moved out of `@/lib/push` in T-1695): the badge count, the badge update and
// the dismissal of a chat's notifications. Like `@/lib/push`, everything here
// only touches browser APIs, read through narrow injectable surfaces so the
// tests run with fakes.
import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';
import type { ServiceWorkerRegistrationLike } from '@/lib/push';

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
