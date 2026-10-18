import { Effect } from 'effect';
import { ApiError } from '@/lib/api';
import { ApiFailure } from '@/lib/effect/errors';
import type { NotificationPermissionState, PushBrowser } from '@/lib/push';

/** A browser or store Promise. Its own error reaches friendlyError unchanged. */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (error: unknown) => error });
}

/** Best effort: a failure here never reaches the page message. */
export function quietly<A>(effect: Effect.Effect<A, unknown>): Effect.Effect<void> {
  return effect.pipe(Effect.orElseSucceed(() => undefined));
}

/** Starts a page action in the background, not tied to the page's life: leaving does not
 * cancel a subscribe, a registration or a rollback in flight. Its failure becomes the message. */
export function runPageAction(
  effect: Effect.Effect<void, unknown>,
  showError: (message: string) => void,
): void {
  Effect.runFork(
    effect.pipe(
      Effect.tapError((error) => Effect.sync(() => showError(friendlyError(error)))),
      Effect.catchCause(() => Effect.void),
    ),
  );
}

/** The same browser, with the permission step answered by a prompt already asked for. */
export function withPermissionAnswer(
  browser: PushBrowser,
  answer: Promise<NotificationPermissionState>,
): PushBrowser {
  return {
    serviceWorker: browser.serviceWorker,
    Notification: {
      get permission() {
        return browser.Notification.permission;
      },
      requestPermission: () => answer,
    },
  };
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiFailure || error instanceof ApiError) {
    if (error.code === 'rate_limited') {
      return 'Too many tries — wait a little and try again.';
    }
    if (error.code === 'device_gone') {
      return 'That device stopped receiving push. Remove it and enable again.';
    }
    if (error.code === 'push_unavailable') {
      return 'Push is not configured on this server yet.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.startsWith('notification permission')) {
      return 'The browser did not grant permission. Allow notifications for this site, then try again.';
    }
    if (error.message.includes('cannot toggle push')) {
      return 'Not connected yet. Wait a moment and try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
