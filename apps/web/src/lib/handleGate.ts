import { Effect } from 'effect';
/**
 * The "asked once" dismissal for the handle gate (T-0163). "Skip for now"
 * records the dismissal for the current browser session, keyed per user id
 * so a different sign-in on the same browser is asked again. Backed by
 * `sessionStorage` with an in-memory fallback when storage throws (private
 * mode, blocked cookies); both die with the tab/session either way.
 */
const dismissedForUser = new Set<string>();

function dismissalKey(userId: string): string {
  return `zilar:handleGateDismissed:${userId}`;
}

/**
 * Runs one sessionStorage step at this sync edge. A storage that throws (or a
 * missing window) gives `fallback`, the same answer as before.
 */
function sessionStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.sessionStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

export function hasDismissedHandleGate(userId: string): boolean {
  if (dismissedForUser.has(userId)) {
    return true;
  }
  return sessionStep(false, (storage) => storage.getItem(dismissalKey(userId)) === '1');
}

export function dismissHandleGate(userId: string): void {
  dismissedForUser.add(userId);
  // Storage may throw (private mode, blocked cookies): the in-memory flag
  // above still covers this page load.
  sessionStep(undefined, (storage) => {
    storage.setItem(dismissalKey(userId), '1');
  });
}

/** Clears the dismissal (sign-out, and tests). */
export function resetHandleGateDismissal(userId?: string): void {
  if (userId === undefined) {
    dismissedForUser.clear();
    return;
  }
  dismissedForUser.delete(userId);
  // Best effort only.
  sessionStep(undefined, (storage) => {
    storage.removeItem(dismissalKey(userId));
  });
}
