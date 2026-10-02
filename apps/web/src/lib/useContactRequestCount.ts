import { useEffect, useState } from 'react';
import { listContactRequests } from '@/lib/api';

/**
 * The incoming contact-request count for the badge where contacts are
 * shown. `null` means "unknown or failed" — the caller shows no badge.
 * Refetched on window focus and every 60 seconds (no realtime channel in
 * this task).
 */
const REFRESH_MS = 60 * 1000;

export function useContactRequestCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const load = (): void => {
      void listContactRequests().then(
        (list) => {
          if (!cancelled) {
            setCount(list.incoming.length);
          }
        },
        () => {
          // A failed call leaves the previous value; the badge stays put.
        },
      );
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [enabled]);

  return count;
}
