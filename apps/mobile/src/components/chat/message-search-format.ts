import { MESSAGE_SEARCH_DEBOUNCE_MS, MESSAGE_SEARCH_MIN_LENGTH } from '@zilar/chat-core';
import type { SearchItem } from '../../lib/search-api';

export { MESSAGE_SEARCH_DEBOUNCE_MS, MESSAGE_SEARCH_MIN_LENGTH };
export {
  MESSAGE_SEARCH_LIMIT,
  activeQuery,
  groupSearchByChat,
  searchResultTitle,
  snippetParts,
} from '@zilar/chat-core';
export type { SearchGroup, SnippetPart } from '@zilar/chat-core';

/** Null until the first debounce settles, so the first keystrokes wait too. */
export type DebouncedQuery = string | null;

export type MessageSearchStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      items: SearchItem[];
      /** The opaque server cursor for the next page; absent means no more. */
      nextBefore?: string;
      /** A failed page keeps the items shown and reports the failure inline. */
      pageError?: { message: string; retry: () => void };
    }
  | { status: 'error'; message: string; rateLimited: boolean; retry: () => void }
  | { status: 'unavailable' };

export function nearEnd(
  contentOffsetY: number,
  contentHeight: number,
  layoutHeight: number,
): boolean {
  return contentHeight - (contentOffsetY + layoutHeight) < 400;
}
