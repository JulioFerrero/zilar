import { useEffect, useReducer, useState } from 'react';

import type { SearchApi } from '@/lib/search-api';
import { MessageSearchController, type MessageSearchStatus } from './message-search';

export type MessageSearchView = MessageSearchStatus & { loadMore?: () => void };

/**
 * Message search over `GET /api/search` (T-0138), the mobile twin of web's
 * `useMessageSearch`: debounced 300 ms, superseded requests cancelled,
 * hidden entirely when the server answers 501 (`search_unavailable`). Pages
 * forward with the server's `nextBefore` cursor. The query text travels only
 * to the search endpoint and is never logged.
 */
export function useMessageSearch(
  searchApi: SearchApi,
  query: string,
  chat?: string,
): MessageSearchView {
  const [, force] = useReducer((count: number) => count + 1, 0);
  // The controller is created once; `force` re-renders on every state change.
  const [controller] = useState(
    () => new MessageSearchController({ api: searchApi, onChange: force }),
  );

  useEffect(() => {
    controller.setQuery(query);
  }, [controller, query]);

  useEffect(() => {
    controller.setChat(chat);
  }, [controller, chat]);

  useEffect(() => () => controller.dispose(), [controller]);

  const view = controller.view;
  if (view.status === 'ready') {
    return { ...view, loadMore: () => controller.loadMore() };
  }
  return view;
}
