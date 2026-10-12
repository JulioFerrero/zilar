import type { ImperativeRouter } from 'expo-router';

/**
 * Pops the current screen when there is history below it, and otherwise lands
 * on the chat list (MUX-6, T-1173). A chat, group or profile opened cold from a
 * notification tap or an App Link has no screen below it, so `router.back()` is
 * a no-op there and the Android hardware back leaves the app; this goes home
 * instead, like Telegram.
 */
export function goBackOrHome(router: ImperativeRouter): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/');
}
