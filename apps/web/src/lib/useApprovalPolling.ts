import { Effect, Schedule } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '@zilar/protocol';
import { getApproval, type PublicApproval } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

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

/**
 * Kept so existing callers and tests that pass a timer seam still typecheck.
 * The poll no longer reads it: the cadence comes from Effect's `Schedule`, and
 * unmount interrupts it.
 */
export interface TimerSource {
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const defaultNow = (): number => Date.now();

interface UseApprovalPollingOptions {
  visibility?: VisibilitySource;
  /** Ignored; see `TimerSource`. */
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
 * The poll runs as Effects: a repeat on `Schedule.fixed`, plus one read when
 * the tab becomes visible again. Unmount, an id change or a reset key
 * interrupts both. `apply` lets callers push an optimistic state (e.g. after
 * a decision) without waiting for the next poll. The effect does not call
 * `setState` synchronously; the loading reset on an id change or a
 * `resetKey` bump is derived during render by comparing the previous key
 * against the current one.
 */
export function useApprovalPolling(
  request: ApprovalRequest,
  options: UseApprovalPollingOptions = {},
): ApprovalPollingResult {
  const visibility = options.visibility ?? defaultVisibility;
  const now = options.now ?? defaultNow;

  const [state, setState] = useState<ApprovalPollingState>({ kind: 'loading' });
  // `latest` is the cell the poll reads; `apply` (called from event handlers)
  // writes to it as well so an optimistic update short-circuits further polls
  // without an effect re-run.
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

  // The timed loop and the visibility read are separate runs, so a visibility
  // read never restarts the loop.
  const [, startLoop, loopControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );
  const [, readNow, readControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );

  useEffect(() => {
    // The id or the reset key changed: drop the cached outcome and start
    // fresh. This runs on the same tick the visible state was reset above.
    latestRef.current = { kind: 'loading' };

    // One read. It checks the latest state when it runs (Effect.suspend), so
    // every tick of the loop sees the outcome of the tick before it.
    const readOnce = (): Effect.Effect<void> =>
      Effect.suspend(() => {
        const prior = latestRef.current;
        if (prior.kind === 'notDecidable') {
          return Effect.void;
        }
        if (prior.kind === 'ready' && prior.approval.status !== 'pending') {
          return Effect.void;
        }
        const requestExpiresAt = new Date(request.expires_at).getTime();
        const expired = now() >= requestExpiresAt;
        // An expired request that was never ready is still allowed one final
        // read; otherwise an expired request with no good state is a no-op.
        if (expired && prior.kind !== 'ready' && prior.kind !== 'loading') {
          return Effect.void;
        }
        if (!visibility.isVisible()) {
          return Effect.void;
        }
        return fromApi(() => getApproval(request.id)).pipe(
          Effect.matchEffect({
            onSuccess: (approval) => {
              const next: ApprovalPollingState = { kind: 'ready', approval };
              latestRef.current = next;
              return sameReady(prior, next) ? Effect.void : Effect.sync(() => setState(next));
            },
            onFailure: (failure) => {
              // A 404 means the viewer cannot decide (or the row is gone): stop
              // polling entirely. Any other failure keeps the last good state so
              // a transient hiccup never flips a decided card into an error.
              if (failure.status === 404) {
                const next: ApprovalPollingState = { kind: 'notDecidable' };
                latestRef.current = next;
                return Effect.sync(() => setState(next));
              }
              if (latestRef.current.kind === 'ready') {
                return Effect.void;
              }
              // No good state yet: surface the error so the card can offer Retry.
              const next: ApprovalPollingState = { kind: 'error' };
              latestRef.current = next;
              return prior.kind === 'error' ? Effect.void : Effect.sync(() => setState(next));
            },
          }),
        );
      });

    // The first read runs right away; then one read per interval while the
    // tab is visible (each read checks visibility and expiry itself).
    startLoop(Effect.repeat(readOnce(), Schedule.fixed(APPROVAL_POLL_INTERVAL_MS)));

    // When the tab becomes visible again, do one immediate read so a decision
    // made on the phone shows up without waiting for the next tick.
    const unsubscribeVisibility = visibility.subscribe(() => {
      readNow(readOnce());
    });

    return () => {
      loopControls.interrupt();
      readControls.interrupt();
      unsubscribeVisibility();
    };
  }, [
    key,
    request.id,
    request.expires_at,
    visibility,
    now,
    startLoop,
    readNow,
    loopControls,
    readControls,
  ]);

  return { state, apply };
}
