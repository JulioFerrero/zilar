import { Effect } from 'effect';
/**
 * The "asked once" dismissal for the handle gate (T-0163). "Skip for now"
 * records the dismissal in this browser with `localStorage` (T-1435), keyed
 * per user id so a different sign-in on the same browser is asked again.
 * Backed by `localStorage` with an in-memory fallback when storage throws
 * (private mode, blocked cookies); the fallback still covers this page load.
 */
const dismissedForUser = new Set<string>();

function dismissalKey(userId: string): string {
  return `zilar:handleGateDismissed:${userId}`;
}

/**
 * Runs one localStorage step at this sync edge. A storage that throws (or a
 * missing window) gives `fallback`, the same answer as before.
 */
function storageStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.localStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

/** Every dismissal key currently persisted in `storage`. */
function dismissalKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith('zilar:handleGateDismissed:')) {
      keys.push(key);
    }
  }
  return keys;
}

export function hasDismissedHandleGate(userId: string): boolean {
  if (dismissedForUser.has(userId)) {
    return true;
  }
  return storageStep(false, (storage) => storage.getItem(dismissalKey(userId)) === '1');
}

export function dismissHandleGate(userId: string): void {
  dismissedForUser.add(userId);
  // Storage may throw (private mode, blocked cookies): the in-memory flag
  // above still covers this page load.
  storageStep(undefined, (storage) => {
    storage.setItem(dismissalKey(userId), '1');
  });
}

/** Clears the dismissal (sign-out, and tests). */
export function resetHandleGateDismissal(userId?: string): void {
  if (userId === undefined) {
    dismissedForUser.clear();
    // Sign-out clears the persisted dismissals too, so no skipped gate stays
    // remembered on this browser; only this key prefix, never the whole store.
    storageStep(undefined, (storage) => {
      for (const key of dismissalKeys(storage)) {
        storage.removeItem(key);
      }
    });
    return;
  }
  dismissedForUser.delete(userId);
  // Best effort only.
  storageStep(undefined, (storage) => {
    storage.removeItem(dismissalKey(userId));
  });
}
