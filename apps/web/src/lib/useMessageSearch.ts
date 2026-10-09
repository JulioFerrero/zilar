import { Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useRef } from 'react';
import { searchMessages, type SearchItem } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

export const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

export type MessageSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; items: SearchItem[] }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };

interface SearchInput {
  readonly query: string;
  readonly chat: string | undefined;
  /** 250 ms after a new query text, 0 when only the chat scope changed. */
  readonly delayMs: number;
}

/** The state a finished search settles on, with the query it answered. */
interface SearchSettled {
  readonly query: string;
  readonly state: MessageSearchState;
}

// One debounced search. A newer search interrupts this one, and the
// interruption aborts its request through the signal.
const searchEffect = (input: SearchInput): Effect.Effect<SearchSettled> =>
  Effect.sleep(input.delayMs).pipe(
    Effect.andThen(
      fromApi((signal) =>
        searchMessages({
          q: input.query,
          ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
          limit: 20,
          signal,
        }),
      ),
    ),
    Effect.map((page): SearchSettled => ({
      query: input.query,
      state: { status: 'ready', items: page.items },
    })),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.succeed<SearchSettled>({
        query: input.query,
        // The server answers 501 when search is off: the UI hides entirely.
        state:
          failure.status === 501
            ? { status: 'unavailable' }
            : { status: 'error', message: 'Could not search messages' },
      }),
    ),
  );

// Message search over `GET /api/search`: debounced 250 ms, superseded
// requests cancelled, hidden entirely when the server answers 501
// (`search_unavailable`). The hook never sends the query text anywhere
// except the search endpoint.
export function useMessageSearch(query: string, chat?: string): MessageSearchState {
  const trimmed = query.trim();
  const active = trimmed.length >= 2 ? trimmed : null;
  const lastActive = useRef<string | null>(null);
  const [result, search, controls] = useAction(searchEffect, { mode: 'replace' });

  // Each change of the query text (or the scope) starts a new search, which
  // interrupts the one before. Only a query change waits out the debounce.
  useEffect(() => {
    const delayMs = lastActive.current === active ? 0 : MESSAGE_SEARCH_DEBOUNCE_MS;
    lastActive.current = active;
    if (active === null) {
      controls.interrupt();
      return;
    }
    search({ query: active, chat, delayMs });
  }, [active, chat, search, controls]);

  if (active === null) {
    return { status: 'idle' };
  }
  // While the debounce runs (or a new query is in flight), the last settled
  // answer for an older query is not shown. `unavailable` stays until the
  // server says otherwise.
  const settled = Option.getOrUndefined(AsyncResult.value(result));
  if (settled?.state.status === 'unavailable') {
    return settled.state;
  }
  if (settled !== undefined && settled.query === active) {
    return settled.state;
  }
  return { status: 'loading' };
}
