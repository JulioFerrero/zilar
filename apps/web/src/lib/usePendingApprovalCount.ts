import { useEffect, useState } from 'react';
import { listApprovals } from '@/lib/api';

/** A pending count plus the pending approval ids (handy for callers/tests). */
export interface PendingApprovalCount {
  count: number;
  ids: string[];
}

/**
 * Returns the current count of approvals waiting for the viewer. `null` means
 * "unknown or failed" — the caller shows no badge in that case. The hook only
 * loads when `enabled` flips to `true`, so opening the menu is what triggers
 * the fetch; once loaded, a failed call leaves the previous value in place.
 *
 * The state setter is only called inside the async callback; the effect body
 * itself does not call `setState` (the repo's lint forbids it).
 */
export function usePendingApprovalCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void listApprovals().then(
      (list) => {
        if (cancelled) {
          return;
        }
        let pending = 0;
        for (const approval of list) {
          if (approval.status === 'pending') {
            pending += 1;
          }
        }
        setCount(pending);
      },
      () => {
        // A failed call leaves the previous value; the badge just stays put.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return count;
}
