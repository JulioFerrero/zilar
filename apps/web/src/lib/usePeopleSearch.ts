import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { lookupByHandle, type HandleProfile } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { isValidHandleShape } from '@/lib/handles';

/** 900 ms of no typing before the lookup fires (the lookup is rate limited). */
export const PEOPLE_SEARCH_DEBOUNCE_MS = 900;

export type PeopleSearchState =
  | { status: 'idle' }
  | { status: 'invalid'; handle: string }
  | { status: 'loading'; handle: string }
  | { status: 'found'; handle: string; profile: HandleProfile }
  | { status: 'missing'; handle: string }
  | { status: 'rate_limited' }
  | { status: 'error'; handle: string };

/** One step of the debounce: wait `delayMs`, then run `run` (a state write or a lookup). */
interface DebouncedStep {
  readonly delayMs: number;
  readonly run: () => void;
}

function handleOf(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed.startsWith('@')) {
    return null;
  }
  return trimmed.slice(1).toLowerCase();
}

/**
 * Exact-handle people search for the search bar. Only a text starting with
 * `@` ever calls the lookup: anything else stays idle. Debounced 900 ms
 * after the last keystroke; a successful handle is cached (the same handle
 * in a row is never looked up twice); a 429 reports rate-limited once and
 * does not retry, but a different handle is always attempted; Enter (the
 * `zilar:search-enter` event) looks up at once. Only the latest lookup
 * writes state: a newer lookup interrupts the one in flight.
 */
export function usePeopleSearch(query: string): {
  state: PeopleSearchState;
  lookupNow: () => void;
  refreshProfile: (profile: HandleProfile) => void;
} {
  const [state, setState] = useState<PeopleSearchState>({ status: 'idle' });
  // Handles cached on success (404 counts as settled too: it stays until
  // the text changes). A generic error clears the entry so Enter retries.
  const cachedRef = useRef<string | null>(null);

  const write = (next: PeopleSearchState): Effect.Effect<void> =>
    Effect.sync(() => {
      setState(next);
    });

  // The lookup as an Effect. A newer lookup replaces this one, so a stale
  // answer never reaches the state.
  const [, lookup] = useAction<string, void, never>(
    (handle) =>
      fromApi(() => lookupByHandle(handle)).pipe(
        Effect.matchEffect({
          onSuccess: (profile) => {
            cachedRef.current = handle;
            return write({ status: 'found', handle, profile });
          },
          onFailure: (failure) => {
            if (failure.status === 404) {
              cachedRef.current = handle;
              return write({ status: 'missing', handle });
            }
            if (failure.code === 'rate_limited') {
              cachedRef.current = handle;
              return write({ status: 'rate_limited' });
            }
            cachedRef.current = null;
            return write({ status: 'error', handle });
          },
        }),
      ),
    { mode: 'replace' },
  );

  const startLookup = useCallback(
    (handle: string) => {
      if (cachedRef.current === handle) {
        return;
      }
      setState({ status: 'loading', handle });
      lookup(handle);
    },
    [lookup],
  );

  // The debounce is an Effect too: a new keystroke interrupts the wait, the
  // same way clearing a timer did.
  const [, debounce, debounceControls] = useAction<DebouncedStep, void, never>(
    (step) => Effect.sleep(step.delayMs).pipe(Effect.andThen(Effect.sync(step.run))),
    { mode: 'replace' },
  );

  // Debounced lookup after the last keystroke. The effect only schedules the
  // step; the step writes the state or starts the lookup, so no setState runs
  // synchronously inside the effect.
  useEffect(() => {
    const handle = handleOf(query);
    if (handle === null) {
      cachedRef.current = null;
      debounce({ delayMs: 0, run: () => setState({ status: 'idle' }) });
    } else if (handle === '' || !isValidHandleShape(handle)) {
      cachedRef.current = null;
      debounce({ delayMs: 0, run: () => setState({ status: 'invalid', handle }) });
    } else if (cachedRef.current !== handle) {
      // A different handle after a 429 is a new search: the cache holds the
      // last attempted handle, so a changed handle always falls through to
      // the lookup (the server re-429s if still limited).
      debounce({ delayMs: PEOPLE_SEARCH_DEBOUNCE_MS, run: () => startLookup(handle) });
    }
    return () => {
      debounceControls.interrupt();
    };
  }, [query, startLookup, debounce, debounceControls]);

  const lookupNow = useCallback(() => {
    const handle = handleOf(query);
    if (handle === null || handle === '' || !isValidHandleShape(handle)) {
      return;
    }
    startLookup(handle);
  }, [query, startLookup]);

  useEffect(() => {
    const onEnter = (): void => lookupNow();
    window.addEventListener('zilar:search-enter', onEnter);
    return () => window.removeEventListener('zilar:search-enter', onEnter);
  }, [lookupNow]);

  const refreshProfile = useCallback((profile: HandleProfile) => {
    setState((current) => {
      if (current.status === 'found' && current.handle === profile.handle.toLowerCase()) {
        return { status: 'found', handle: current.handle, profile };
      }
      return current;
    });
  }, []);

  return { state, lookupNow, refreshProfile };
}
