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

export function hasDismissedHandleGate(userId: string): boolean {
  if (dismissedForUser.has(userId)) {
    return true;
  }
  try {
    return window.sessionStorage.getItem(dismissalKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function dismissHandleGate(userId: string): void {
  dismissedForUser.add(userId);
  try {
    window.sessionStorage.setItem(dismissalKey(userId), '1');
  } catch {
    // Storage may throw (private mode, blocked cookies): the in-memory
    // flag above still covers this page load.
  }
}

/** Clears the dismissal (sign-out, and tests). */
export function resetHandleGateDismissal(userId?: string): void {
  if (userId === undefined) {
    dismissedForUser.clear();
    return;
  }
  dismissedForUser.delete(userId);
  try {
    window.sessionStorage.removeItem(dismissalKey(userId));
  } catch {
    // Best effort only.
  }
}
