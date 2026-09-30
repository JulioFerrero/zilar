import { useEffect, useRef, useState } from 'react';
import { ApiError, searchMessages, type SearchItem } from '@/lib/api';

export const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

export type MessageSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; items: SearchItem[] }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };

// Message search over `GET /api/search`: debounced 250 ms, superseded
// requests cancelled, hidden entirely when the server answers 501
// (`search_unavailable`). The hook never sends the query text anywhere
// except the search endpoint.
export function useMessageSearch(query: string, chat?: string): MessageSearchState {
  const trimmed = query.trim();
  const active = trimmed.length >= 2 ? trimmed : null;
  // `null` until the first debounce settles, so even the first keystrokes
  // wait the 250 ms instead of firing on mount.
  const [debounced, setDebounced] = useState<string | null>(null);
  const [state, setState] = useState<MessageSearchState>({ status: 'idle' });
  const requestId = useRef(0);

  // Debounce the query text: the timer callback is the only place that
  // writes the debounced value, so no setState runs synchronously in here.
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        requestId.current += 1;
        setDebounced(active);
      },
      active === null ? 0 : MESSAGE_SEARCH_DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [active]);

  // Fire the request once the debounced text (or scope) settles. State
  // below is set only from the async callbacks, never synchronously.
  useEffect(() => {
    if (debounced === null) {
      return;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    void searchMessages({
      q: debounced,
      ...(chat === undefined || chat === '' ? {} : { chat }),
      limit: 20,
      signal: controller.signal,
    }).then(
      (page) => {
        if (requestId.current !== id) {
          return;
        }
        setState({ status: 'ready', items: page.items });
      },
      (error: unknown) => {
        if (requestId.current !== id) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (error instanceof ApiError && error.status === 501) {
          setState({ status: 'unavailable' });
          return;
        }
        setState({ status: 'error', message: 'Could not search messages' });
      },
    );
    return () => {
      controller.abort();
    };
  }, [debounced, chat]);

  if (active === null) {
    return { status: 'idle' };
  }
  if (debounced !== active || (state.status !== 'ready' && state.status !== 'error')) {
    // While the debounce timer runs (or a fresh scope settles), report
    // loading without writing state in an effect.
    if (state.status === 'unavailable') {
      return state;
    }
    return { status: 'loading' };
  }
  return state;
}
