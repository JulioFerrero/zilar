import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '@zilar/protocol';
import { ApiError, getApproval, type PublicApproval } from '@/lib/api';

export type ApprovalPollingState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

export interface ApprovalPollingResult {
  state: ApprovalPollingState;
  /**
   * Push an optimistic state in. The card uses this after a decision so the
   * buttons vanish at once instead of waiting for the next poll. The next
   * poll confirms (or corrects) the value.
   */
  apply: (next: ApprovalPollingState) => void;
}

/** The poll cadence while the card is open and the tab is visible. */
export const APPROVAL_POLL_INTERVAL_MS = 10_000;

/** A function seam so they can be swapped in tests without touching the DOM. */
export interface VisibilitySource {
  /** Tells whether the page is currently visible. */
  isVisible: () => boolean;
  /** Calls `onVisible` whenever the page becomes visible. Returns an unsubscribe. */
  subscribe: (onVisible: () => void) => () => void;
}

const defaultVisibility: VisibilitySource = {
  isVisible: () =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  subscribe: (onVisible) => {
    if (typeof document === 'undefined') {
      return () => {};
    }
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        onVisible();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/** A scheduler seam so tests can advance fake timers deterministically. */
export interface TimerSource {
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const defaultTimers: TimerSource = {
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (handle) => window.clearInterval(handle),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

const defaultNow = (): number => Date.now();

interface UseApprovalPollingOptions {
  visibility?: VisibilitySource;
  timers?: TimerSource;
  /** Overrides `Date.now()` for deterministic expiry checks. */
  now?: () => number;
  /**
   * Bump to force the hook to drop its current state and re-fetch from the
   * start. The card uses this on a manual retry after a hard error.
   */
  resetKey?: number;
}

// Two ready states are "the same" when the id, the human-meaningful status
// and the decidedAt haven't changed. Other fields (summary, expiresAt, …)
// can shift without changing what the card shows.
function sameReady(left: ApprovalPollingState, right: ApprovalPollingState): boolean {
  if (left.kind !== 'ready' || right.kind !== 'ready') {
    return false;
  }
  return (
    left.approval.id === right.approval.id &&
    left.approval.status === right.approval.status &&
    left.approval.decidedAt === right.approval.decidedAt
  );
}

/**
 * Loads `request.id` and re-reads it on a fixed cadence while it is still
 * `pending`, the page is visible, and the request has not passed its
 * `expires_at`. The state stops polling on a non-pending status, a 404 (the
 * viewer cannot decide), the unmount, an id change, and an expiry that flips
 * the last read to `expired`. A failed poll keeps the last good state.
 *
 * The hook owns its own state. `apply` lets callers push an optimistic state
 * (e.g. after a decision) without waiting for the next poll. The effect does
 * not call `setState` synchronously; the loading reset on an id change or a
 * `resetKey` bump is derived during render by comparing the previous key
 * against the current one.
 */
export function useApprovalPolling(
  request: ApprovalRequest,
  options: UseApprovalPollingOptions = {},
): ApprovalPollingResult {
  const visibility = options.visibility ?? defaultVisibility;
  const timers = options.timers ?? defaultTimers;
  const now = options.now ?? defaultNow;

  const [state, setState] = useState<ApprovalPollingState>({ kind: 'loading' });
  // `latest` is the cell the interval/visibility callbacks read; `apply`
  // (called from event handlers) writes to it as well so an optimistic
  // update short-circuits further polls without an effect re-run.
  const latestRef = useRef<ApprovalPollingState>({ kind: 'loading' });

  const apply = useCallback((next: ApprovalPollingState): void => {
    latestRef.current = next;
    setState(next);
  }, []);

  // Reset the visible state to `loading` while keeping the reset out of the
  // effect body: if the id or the reset key changed this render, the previous
  // render's key is still in `lastKey`, so we drop both. The setState is
  // called during render, not inside an effect body (the repo's lint forbids
  // that). The polling ref is reset inside the effect so it stays out of
  // oxlint's "refs during render" path.
  const resetKey = options.resetKey ?? 0;
  const key = `${request.id}#${resetKey}`;
  const [lastKey, setLastKey] = useState<string>(key);
  if (lastKey !== key) {
    setLastKey(key);
    setState({ kind: 'loading' });
  }

  useEffect(() => {
    // The id or the reset key changed: drop the cached outcome and start
    // fresh. This runs on the same tick the visible state was reset above.
    latestRef.current = { kind: 'loading' };
    let cancelled = false;

    const runOne = (): void => {
      const prior = latestRef.current;
      if (prior.kind === 'notDecidable') {
        return;
      }
      if (prior.kind === 'ready' && prior.approval.status !== 'pending') {
        return;
      }
      const requestExpiresAt = new Date(request.expires_at).getTime();
      const expired = now() >= requestExpiresAt;
      // An expired request that was never ready is still allowed one final
      // read; otherwise an expired request with no good state is a no-op.
      if (expired && prior.kind !== 'ready' && prior.kind !== 'loading') {
        return;
      }
      if (!visibility.isVisible()) {
        return;
      }
      void getApproval(request.id).then(
        (approval) => {
          if (cancelled) {
            return;
          }
          const next: ApprovalPollingState = { kind: 'ready', approval };
          latestRef.current = next;
          if (!sameReady(prior, next)) {
            setState(next);
          }
        },
        (error: unknown) => {
          if (cancelled) {
            return;
          }
          // A 404 means the viewer cannot decide (or the row is gone): stop
          // polling entirely. Any other failure keeps the last good state so
          // a transient hiccup never flips a decided card into an error.
          if (error instanceof ApiError && error.status === 404) {
            const next: ApprovalPollingState = { kind: 'notDecidable' };
            latestRef.current = next;
            if (prior.kind === 'loading' || prior.kind === 'ready' || prior.kind === 'error') {
              setState(next);
            }
            return;
          }
          if (latestRef.current.kind === 'ready') {
            return;
          }
          // No good state yet: surface the error so the card can offer Retry.
          const next: ApprovalPollingState = { kind: 'error' };
          latestRef.current = next;
          if (prior.kind !== 'error') {
            setState(next);
          }
        },
      );
    };

    // First read right away.
    runOne();

    // Tick while pending and visible. The interval keeps firing on a fixed
    // cadence; each tick checks visibility/expiry before doing anything.
    const intervalHandle = timers.setInterval(runOne, APPROVAL_POLL_INTERVAL_MS);

    // When the tab becomes visible again, do one immediate read so a decision
    // made on the phone shows up without waiting for the next tick.
    const unsubscribeVisibility = visibility.subscribe(runOne);

    return () => {
      cancelled = true;
      timers.clearInterval(intervalHandle);
      unsubscribeVisibility();
    };
  }, [key, request.id, request.expires_at, visibility, timers, now]);

  return { state, apply };
}
