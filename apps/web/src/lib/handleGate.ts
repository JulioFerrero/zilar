import { Effect } from 'effect';
/** Asked once per user id, so a different sign-in on the same browser is asked again.
 * Backed by localStorage with an in-memory fallback when storage throws (private mode). */
const dismissedForUser = new Set<string>();

function dismissalKey(userId: string): string {
  return `zilar:handleGateDismissed:${userId}`;
}

/** A storage that throws (or a missing window) gives fallback. */
export function storageStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.localStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

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
  // Storage may throw (private mode, blocked cookies): the in-memory flag still covers this load.
  storageStep(undefined, (storage) => {
    storage.setItem(dismissalKey(userId), '1');
  });
}

/** Clears the dismissal (sign-out, and tests). */
export function resetHandleGateDismissal(userId?: string): void {
  if (userId === undefined) {
    dismissedForUser.clear();
    // Sign-out clears the persisted dismissals too, but only this key prefix, never the whole store.
    storageStep(undefined, (storage) => {
      for (const key of dismissalKeys(storage)) {
        storage.removeItem(key);
      }
    });
    return;
  }
  dismissedForUser.delete(userId);
  storageStep(undefined, (storage) => {
    storage.removeItem(dismissalKey(userId));
  });
}
