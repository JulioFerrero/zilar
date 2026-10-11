import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchDirectory, searchUsers, type DirectoryEntry, type HandleProfile } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

export const PEOPLE_SEARCH_MIN_LENGTH = 3;
export const PEOPLE_SEARCH_DEBOUNCE_MS = 300;
export const PUBLIC_GROUP_SEARCH_LIMIT = 5;
// The contract caps `q` at 64 characters; the directory query caps at 100.
const USER_SEARCH_MAX_LENGTH = 64;
const GROUP_SEARCH_MAX_LENGTH = 100;

export type PeopleSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; entries: HandleProfile[] }
  | { status: 'rate_limited'; query: string }
  | { status: 'error'; query: string };

export type GroupSearchState =
  { status: 'idle' } | { status: 'results'; entries: DirectoryEntry[] };

/** One step of the debounce: wait `delayMs`, then run `run` (a state write or a lookup). */
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
 * Telegram-style people search for the search bar: any query of 3+ characters
 * (after one leading `@`) is debounced 300 ms and looked up. It stays idle
 * under 3 characters. A 429 shows the rate-limited line; any other failure
 * shows the error line. Only the latest query writes state: a response for an
 * older query is ignored.
 */
export function usePeopleSearch(query: string): {
  state: PeopleSearchState;
  updateProfile: (profile: HandleProfile) => void;
} {
  const [state, setState] = useState<PeopleSearchState>({ status: 'idle' });
  // The query the answer must still be for. A response that no longer matches
  // is dropped, so an older lookup never overwrites a newer one.
  const latestQuery = useRef('');

  const [, lookup, lookupControls] = useAction<string, void, never>(
    (q) =>
      fromApi(() => searchUsers(q)).pipe(
        Effect.matchEffect({
          onSuccess: (result) => {
            if (latestQuery.current !== q) {
              return Effect.void;
            }
            return Effect.sync(() =>
              setState({ status: 'results', query: q, entries: [...result.entries] }),
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
        delayMs: PEOPLE_SEARCH_DEBOUNCE_MS,
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

  // A relation change (add, accept, block) updates that entry in place.
  const updateProfile = useCallback((profile: HandleProfile) => {
    setState((current) => {
      if (current.status !== 'results') {
        return current;
      }
      return {
        ...current,
        entries: current.entries.map((entry) =>
          entry.userId === profile.userId ? profile : entry,
        ),
      };
    });
  }, []);

  return { state, updateProfile };
}

/**
 * The public-groups half of the chat-list search: the same 3-character and
 * debounce rules, up to 5 rows. Any failure hides the section (idle), with no
 * message.
 */
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
      debounce({ delayMs: PEOPLE_SEARCH_DEBOUNCE_MS, run: () => load(q) });
    }
    return () => {
      debounceControls.interrupt();
      loadControls.interrupt();
    };
  }, [query, load, debounce, debounceControls, loadControls]);

  return state;
}
