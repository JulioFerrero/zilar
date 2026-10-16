import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

import type { ContactsApi, HandleProfile } from '@/lib/contacts-api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

// The server searches from 3 characters on, after one leading `@`.
const PEOPLE_SEARCH_MIN_LENGTH = 3;
// Web's prefix search waits 300 ms after the last keystroke (unlike the exact
// `@handle` lookup, which uses the shared `PEOPLE_SEARCH_DEBOUNCE_MS`).
const PEOPLE_PREFIX_DEBOUNCE_MS = 300;
// The contract caps `q` at 64 characters.
const USER_SEARCH_MAX_LENGTH = 64;

export type PeoplePrefixSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; entries: HandleProfile[] }
  | { status: 'rate_limited'; query: string }
  | { status: 'error'; query: string };

/** One step of the debounce: wait `delayMs`, then run `run`. */
interface DebouncedStep {
  readonly delayMs: number;
  readonly run: () => void;
}

/**
 * Trims, strips one leading `@` and lowercases, exactly like the server, so
 * "idle under 3 characters" is decided the same on both sides.
 */
export function normalizePeopleQuery(query: string): string {
  const trimmed = query.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}

/**
 * The phone's people prefix search for the chat-list search bar (T-1668): the
 * mobile twin of web's `usePeopleSearch`. Any query of 3+ characters (after
 * one leading `@`) is debounced and looked up through `GET /users/search`. It
 * stays idle under 3 characters. A 429 shows the rate-limited state; any other
 * failure shows the error state. Only the latest query writes state: a
 * response for an older query is dropped.
 */
export function usePeoplePrefixSearch(api: ContactsApi, query: string): PeoplePrefixSearchState {
  const [state, setState] = useState<PeoplePrefixSearchState>({ status: 'idle' });
  // The query the answer must still be for. A response that no longer matches
  // is dropped, so an older lookup never overwrites a newer one.
  const latestQuery = useRef('');

  const [, lookup, lookupControls] = useAction<string, void, never>(
    (q) =>
      fromApi(() => api.searchUsers(q)).pipe(
        Effect.matchEffect({
          onSuccess: (entries) => {
            if (latestQuery.current !== q) {
              return Effect.void;
            }
            return Effect.sync(() =>
              setState({ status: 'results', query: q, entries: [...entries] }),
            );
          },
          onFailure: (failure) => {
            if (latestQuery.current !== q) {
              return Effect.void;
            }
            return Effect.sync(() =>
              setState(
                failure.code === 'rate_limited'
                  ? { status: 'rate_limited', query: q }
                  : { status: 'error', query: q },
              ),
            );
          },
        }),
      ),
    { mode: 'replace' },
  );

  // The debounce is an Effect too: a new keystroke interrupts the wait.
  const [, debounce, debounceControls] = useAction<DebouncedStep, void, never>(
    (step) => Effect.sleep(step.delayMs).pipe(Effect.andThen(Effect.sync(step.run))),
    { mode: 'replace' },
  );

  useEffect(() => {
    const q = normalizePeopleQuery(query).slice(0, USER_SEARCH_MAX_LENGTH);
    latestQuery.current = q;
    if (q.length < PEOPLE_SEARCH_MIN_LENGTH) {
      debounce({ delayMs: 0, run: () => setState({ status: 'idle' }) });
    } else {
      debounce({
        delayMs: PEOPLE_PREFIX_DEBOUNCE_MS,
        run: () => {
          setState({ status: 'loading', query: q });
          lookup(q);
        },
      });
    }
    return () => {
      debounceControls.interrupt();
      lookupControls.interrupt();
    };
  }, [query, lookup, debounce, debounceControls, lookupControls]);

  return state;
}
