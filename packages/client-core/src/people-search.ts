import {
  normalizePeopleQuery,
  PEOPLE_PREFIX_DEBOUNCE_MS,
  PEOPLE_SEARCH_MIN_LENGTH,
  USER_SEARCH_MAX_LENGTH,
} from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiFailure, type ApiFailure } from './errors';

export type PeopleSearchState<P> =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; entries: P[] }
  | { status: 'rate_limited'; query: string }
  | { status: 'error'; query: string };

export const peopleFailureState = <P>(query: string, failure: ApiFailure): PeopleSearchState<P> =>
  failure.status === 429 || failure.code === 'rate_limited'
    ? { status: 'rate_limited', query }
    : { status: 'error', query };

/** Shared people prefix search: 3+ characters, 300 ms debounce, latest query wins. */
export function usePeoplePrefixSearch<P>(
  search: (query: string) => Promise<readonly P[]>,
  query: string,
): {
  state: PeopleSearchState<P>;
  setEntries: (update: (entries: P[]) => P[]) => void;
} {
  const [state, setState] = useState<PeopleSearchState<P>>({ status: 'idle' });
  const latestQuery = useRef('');
  // Callers may pass a new lambda each render; the latest one is used.
  const latestSearch = useRef(search);
  useEffect(() => {
    latestSearch.current = search;
  });

  useEffect(() => {
    const q = normalizePeopleQuery(query).slice(0, USER_SEARCH_MAX_LENGTH);
    latestQuery.current = q;
    const longEnough = q.length >= PEOPLE_SEARCH_MIN_LENGTH;
    const write = (next: PeopleSearchState<P>) => {
      if (latestQuery.current === q) setState(next);
    };
    const lookup = longEnough
      ? Effect.tryPromise({ try: () => latestSearch.current(q), catch: toApiFailure }).pipe(
          Effect.match({
            onSuccess: (entries) => write({ status: 'results', query: q, entries: [...entries] }),
            onFailure: (failure) => write(peopleFailureState<P>(q, failure)),
          }),
        )
      : Effect.void;
    const fiber = Effect.runFork(
      Effect.sleep(longEnough ? PEOPLE_PREFIX_DEBOUNCE_MS : 0).pipe(
        Effect.andThen(
          Effect.sync(() =>
            write(longEnough ? { status: 'loading', query: q } : { status: 'idle' }),
          ),
        ),
        Effect.andThen(lookup),
      ),
    );
    return () => void Effect.runFork(Fiber.interrupt(fiber));
  }, [query]);

  // A relation change (add, accept, block) updates that entry in place.
  const setEntries = useCallback((update: (entries: P[]) => P[]) => {
    setState((current) =>
      current.status === 'results' ? { ...current, entries: update(current.entries) } : current,
    );
  }, []);

  return { state, setEntries };
}
