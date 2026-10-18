// Everything here only touches browser APIs, read through narrow injectable surfaces for tests.
import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';
import type { ServiceWorkerRegistrationLike } from '@/lib/push';

// Shows total unread excluding muted chats; a zero count clears the badge, and a missing API is a no-op.
export { totalBadgeUnread } from '@zilar/chat-core';
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
    // Browsers may reject (e.g. permission revoked after install): the badge is decoration.
    return Effect.try(() => badgeCall(surface, unread)).pipe(
      Effect.flatMap((pending) =>
        pending === undefined ? Effect.void : Effect.tryPromise(() => pending),
      ),
      Effect.ignore,
    );
  });

// Tags are per-message, so this enumerates all visible notifications and closes the ones
// whose data.chatId matches; filtering by tag would miss every message-tagged one.
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
  const registration =
    pending === undefined
      ? undefined
      : yield* Effect.tryPromise(() => pending).pipe(Effect.orElseSucceed(() => undefined));
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
