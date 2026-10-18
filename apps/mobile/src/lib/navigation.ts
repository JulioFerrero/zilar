import type { ImperativeRouter } from 'expo-router';

/**
 * A chat, group or profile opened cold from a notification or App Link has no screen below it, so `router.back()` leaves the app; this goes home instead.
 */
export function goBackOrHome(router: ImperativeRouter): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/');
}
