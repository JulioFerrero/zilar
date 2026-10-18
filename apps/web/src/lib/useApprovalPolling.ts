import { Effect, Schedule } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '@zilar/protocol';
import { getApproval, type PublicApproval } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';

export type ApprovalPollingState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

export interface ApprovalPollingResult {
  state: ApprovalPollingState;
  /** Push an optimistic state in after a decision so the buttons vanish at once; the
   * next poll confirms or corrects it. */
  apply: (next: ApprovalPollingState) => void;
}

/** The poll cadence while the card is open and the tab is visible. */
export const APPROVAL_POLL_INTERVAL_MS = 10_000;

/** A function seam so it can be swapped in tests without touching the DOM. */
export interface VisibilitySource {
  isVisible: () => boolean;
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

/** Kept so callers that pass a timer seam still typecheck; the poll no longer reads it. */
export interface TimerSource {
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const defaultNow = (): number => Date.now();

interface UseApprovalPollingOptions {
  visibility?: VisibilitySource;
  /** Ignored; see TimerSource. */
  timers?: TimerSource;
  /** Overrides Date.now() for deterministic expiry checks. */
  now?: () => number;
  /** Bump to force the hook to drop its state and re-fetch; the card uses it on a retry. */
  resetKey?: number;
}

// Two ready states are the same when the id, the status and the decidedAt have not changed;
// the other fields can shift without changing what the card shows.
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

/** Polls request.id while it is pending, the page is visible and it has not expired. Stops on
 * a non-pending status, a 404 (the viewer cannot decide), unmount, an id change and expiry;
 * a failed poll keeps the last good state. The effect never calls setState synchronously. */
export function useApprovalPolling(
  request: ApprovalRequest,
  options: UseApprovalPollingOptions = {},
): ApprovalPollingResult {
  const visibility = options.visibility ?? defaultVisibility;
  const now = options.now ?? defaultNow;

  const [state, setState] = useState<ApprovalPollingState>({ kind: 'loading' });
  // The cell the poll reads; apply writes it too, so an optimistic update short-circuits polls.
  const latestRef = useRef<ApprovalPollingState>({ kind: 'loading' });

  const apply = useCallback((next: ApprovalPollingState): void => {
    latestRef.current = next;
    setState(next);
  }, []);

  // Reset during render (the repo's lint forbids setState in an effect body), comparing the
  // previous key; the polling ref resets inside the effect to stay out of oxlint's refs path.
  const resetKey = options.resetKey ?? 0;
  const key = `${request.id}#${resetKey}`;
  const [lastKey, setLastKey] = useState<string>(key);
  if (lastKey !== key) {
    setLastKey(key);
    setState({ kind: 'loading' });
  }

  // The timed loop and the visibility read are separate runs, so a focus never restarts the loop.
  const [, startLoop, loopControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );
  const [, readNow, readControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );

  useEffect(() => {
    // The id or the reset key changed: drop the cached outcome and start fresh.
    latestRef.current = { kind: 'loading' };

    // One read that checks the latest state when it runs, so each tick sees the previous one.
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
        // An expired request that was never ready gets one final read; otherwise it is a no-op.
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
              // A 404 stops polling; any other failure keeps the last good state, so a hiccup
              // never flips a decided card into an error.
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

    // The first read runs right away, then one per interval while the tab is visible.
    startLoop(Effect.repeat(readOnce(), Schedule.fixed(APPROVAL_POLL_INTERVAL_MS)));

    // When the tab becomes visible again, read once so a phone-side decision shows up.
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
