import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, lookupByHandle, type HandleProfile } from '@/lib/api';
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
 * writes state (a request id drops stale responses).
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
  const requestRef = useRef(0);

  const startLookup = useCallback((handle: string) => {
    if (cachedRef.current === handle) {
      return;
    }
    const id = requestRef.current + 1;
    requestRef.current = id;
    setState({ status: 'loading', handle });
    void lookupByHandle(handle).then(
      (profile) => {
        if (requestRef.current !== id) {
          return;
        }
        cachedRef.current = handle;
        setState({ status: 'found', handle, profile });
      },
      (error: unknown) => {
        if (requestRef.current !== id) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          cachedRef.current = handle;
          setState({ status: 'missing', handle });
          return;
        }
        if (error instanceof ApiError && error.code === 'rate_limited') {
          cachedRef.current = handle;
          setState({ status: 'rate_limited' });
          return;
        }
        cachedRef.current = null;
        setState({ status: 'error', handle });
      },
    );
  }, []);

  // Debounced lookup after the last keystroke. The effect only schedules the
  // timer; the callback fires the lookup directly, so no setState runs
  // synchronously inside the effect.
  useEffect(() => {
    const handle = handleOf(query);
    if (handle === null) {
      cachedRef.current = null;
      const pending = setTimeout(() => setState({ status: 'idle' }), 0);
      return () => clearTimeout(pending);
    }
    if (handle === '' || !isValidHandleShape(handle)) {
      cachedRef.current = null;
      const next: PeopleSearchState = { status: 'invalid', handle };
      const pending = setTimeout(() => setState(next), 0);
      return () => clearTimeout(pending);
    }
    // A different handle after a 429 is a new search: the cache holds the
    // last attempted handle, so a changed handle always falls through to
    // the lookup below (the server re-429s if still limited).
    if (cachedRef.current === handle) {
      return;
    }
    const pending = setTimeout(() => startLookup(handle), PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(pending);
  }, [query, startLookup]);

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
