import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, lookupByHandle, type HandleProfile } from '@/lib/api';
import { isValidHandleShape } from '@/lib/handles';

/** 900 ms of no typing before the lookup fires (the lookup is rate limited). */
export const PEOPLE_SEARCH_DEBOUNCE_MS = 900;

export type PeopleSearchState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'loading'; handle: string }
  | { status: 'found'; handle: string; profile: HandleProfile }
  | { status: 'missing'; handle: string }
  | { status: 'rate_limited' }
  | { status: 'error' };

function handleOf(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed.startsWith('@')) {
    return null;
  }
  return trimmed.slice(1).toLowerCase();
}

/**
 * Exact-handle people search for the search bar. Only a text starting with
 * `@` followed by a valid handle shape ever calls the lookup: anything else
 * stays idle. Debounced 900 ms after the last keystroke; the same handle in
 * a row is never looked up twice (the last result is cached until the text
 * changes). A 429 reports rate-limited once and does not retry; Enter (the
 * `zilar:search-enter` event) looks up at once.
 */
export function usePeopleSearch(query: string): {
  state: PeopleSearchState;
  lookupNow: () => void;
  refreshProfile: (profile: HandleProfile) => void;
} {
  const [state, setState] = useState<PeopleSearchState>({ status: 'idle' });
  const lastLookedUpRef = useRef<string | null>(null);

  const runLookup = useCallback((handle: string, currentStatus: PeopleSearchState['status']) => {
    if (lastLookedUpRef.current === handle) {
      return;
    }
    if (currentStatus === 'rate_limited') {
      return;
    }
    lastLookedUpRef.current = handle;
    setState({ status: 'loading', handle });
    void lookupByHandle(handle).then(
      (profile) => {
        setState({ status: 'found', handle, profile });
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'missing', handle });
          return;
        }
        if (error instanceof ApiError && error.code === 'rate_limited') {
          setState({ status: 'rate_limited' });
          return;
        }
        setState({ status: 'error' });
      },
    );
  }, []);

  // Debounced lookup after the last keystroke. The effect only schedules the
  // timer; the callback reads the latest status from the state updater, so
  // no ref is read during render and no setState runs synchronously here.
  useEffect(() => {
    const handle = handleOf(query);
    if (handle === null || handle === '' || !isValidHandleShape(handle)) {
      lastLookedUpRef.current = null;
      const next: PeopleSearchState = handle === null ? { status: 'idle' } : { status: 'invalid' };
      const pending = setTimeout(() => setState(next), 0);
      return () => clearTimeout(pending);
    }
    if (lastLookedUpRef.current === handle) {
      return;
    }
    const pending = setTimeout(() => {
      setState((current) => {
        runLookup(handle, current.status);
        return current;
      });
    }, PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(pending);
  }, [query, runLookup]);

  const lookupNow = useCallback(() => {
    const handle = handleOf(query);
    if (handle === null || handle === '' || !isValidHandleShape(handle)) {
      return;
    }
    setState((current) => {
      runLookup(handle, current.status);
      return current;
    });
  }, [query, runLookup]);

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
