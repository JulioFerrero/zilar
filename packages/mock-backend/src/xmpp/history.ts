// RSM paging over a seeded thread. It mirrors the client-core history test's
// server fake: no `before` means the newest page; `before` an id means the page
// ending just before it. The page is oldest first and `first` is its oldest id,
// the cursor `loadOlder` and `openAtMessage` page from.
import type { ChatMessage, HistoryPage, LoadHistoryOptions } from '@zilar/xmpp-core';

/** The page size used when a caller names none, like the real core. */
export const DEFAULT_HISTORY_MAX = 50;

export function historyPage(
  thread: readonly ChatMessage[],
  options: LoadHistoryOptions | undefined,
): HistoryPage {
  const max = options?.max ?? DEFAULT_HISTORY_MAX;
  const before = options?.before;
  const end = before === undefined ? thread.length : thread.findIndex((item) => item.id === before);
  // An unknown cursor has nothing older to serve; the caller stops paging.
  if (end === -1) {
    return { messages: [], complete: true };
  }
  const start = Math.max(0, end - max);
  const messages = thread.slice(start, end);
  const first = messages[0]?.id;
  return {
    messages,
    complete: start === 0,
    ...(first === undefined ? {} : { first }),
  };
}
