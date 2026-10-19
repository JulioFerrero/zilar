import {
  normalizePeopleQuery,
  PEOPLE_PREFIX_DEBOUNCE_MS,
  PEOPLE_SEARCH_MIN_LENGTH,
} from '@zilar/chat-core';
import {
  usePeoplePrefixSearch,
  type PeopleSearchState as SharedState,
  fromApi,
} from '@zilar/client-core';
import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchDirectory, searchUsers, type DirectoryEntry, type HandleProfile } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';

export const PUBLIC_GROUP_SEARCH_LIMIT = 5;
const GROUP_SEARCH_MAX_LENGTH = 100;

export type PeopleSearchState = SharedState<HandleProfile>;

export type GroupSearchState =
  { status: 'idle' } | { status: 'results'; entries: DirectoryEntry[] };

interface DebouncedStep {
  readonly delayMs: number;
  readonly run: () => void;
}

export function usePeopleSearch(query: string): {
  state: PeopleSearchState;
  updateProfile: (profile: HandleProfile) => void;
} {
  const { state, setEntries } = usePeoplePrefixSearch(
    (q) => searchUsers(q).then((result) => result.entries),
    query,
  );

  const updateProfile = useCallback(
    (profile: HandleProfile) =>
      setEntries((entries) =>
        entries.map((entry) => (entry.userId === profile.userId ? profile : entry)),
      ),
    [setEntries],
  );

  return { state, updateProfile };
}

/** The public-groups half of the chat-list search: 3-character minimum, up to 5 rows;
 * any failure hides the section. */
export function useGroupSearch(query: string): GroupSearchState {
  const [state, setState] = useState<GroupSearchState>({ status: 'idle' });
  const latestQuery = useRef('');

  const [, load, loadControls] = useAction<string, void, never>(
    (q) =>
      fromApi(() => searchDirectory({ q })).pipe(
        Effect.matchEffect({
          onSuccess: (page) => {
            if (latestQuery.current !== q) {
              return Effect.void;
            }
            return Effect.sync(() =>
              setState({
                status: 'results',
                entries: [...page.entries].slice(0, PUBLIC_GROUP_SEARCH_LIMIT),
              }),
            );
          },
          onFailure: () => Effect.sync(() => setState({ status: 'idle' })),
        }),
      ),
    { mode: 'replace' },
  );

  const [, debounce, debounceControls] = useAction<DebouncedStep, void, never>(
    (step) => Effect.sleep(step.delayMs).pipe(Effect.andThen(Effect.sync(step.run))),
    { mode: 'replace' },
  );

  useEffect(() => {
    const q = normalizePeopleQuery(query).slice(0, GROUP_SEARCH_MAX_LENGTH);
    latestQuery.current = q;
    if (q.length < PEOPLE_SEARCH_MIN_LENGTH) {
      debounce({ delayMs: 0, run: () => setState({ status: 'idle' }) });
    } else {
      debounce({ delayMs: PEOPLE_PREFIX_DEBOUNCE_MS, run: () => load(q) });
    }
    return () => {
      debounceControls.interrupt();
      loadControls.interrupt();
    };
  }, [query, load, debounce, debounceControls, loadControls]);

  return state;
}
