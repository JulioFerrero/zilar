import type { SearchItem } from '../../lib/search-api';

/** How long the hook waits after the last keystroke before searching. */
export const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

/** The server needs at least 2 characters; shorter text never searches. */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;

/** Null until the first debounce settles, so the first keystrokes wait too. */
export type DebouncedQuery = string | null;

/** The query text that searches, or null when it is too short to send. */
export function activeQuery(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.length >= MESSAGE_SEARCH_MIN_LENGTH ? trimmed : null;
}

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

/** True when the scrolled list is near its end and should page forward. */
export function nearEnd(
  contentOffsetY: number,
  contentHeight: number,
  layoutHeight: number,
): boolean {
  return contentHeight - (contentOffsetY + layoutHeight) < 400;
}

/**
 * One snippet highlight range, clamped to the snippet text. Snippets are
 * plain text from the server plus character ranges (`marks`); the server
 * counts characters like `[...snippet]`, so the client does too. Out-of-range
 * or empty ranges are dropped, never rendered.
 */
export interface SnippetPart {
  text: string;
  mark: boolean;
}

export function snippetParts(snippet: string, marks: Array<[number, number]>): SnippetPart[] {
  const chars = [...snippet];
  const sorted = [...marks]
    .filter(([start, end]) => start < end && start >= 0 && end <= chars.length)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) {
      continue;
    }
    if (start > cursor) {
      parts.push({ text: chars.slice(cursor, start).join(''), mark: false });
    }
    parts.push({ text: chars.slice(start, end).join(''), mark: true });
    cursor = end;
  }
  if (cursor < chars.length) {
    parts.push({ text: chars.slice(cursor).join(''), mark: false });
  }
  return parts;
}

export interface SearchGroup {
  chatJid: string;
  title: string;
  items: SearchItem[];
}

/**
 * Groups hits by chat, newest group first (the server already answers newest
 * first, so first-seen order is newest-first). A chat the store has not
 * loaded falls back to its JID, never a guess.
 */
export function groupSearchByChat(items: SearchItem[], titles: Map<string, string>): SearchGroup[] {
  const order: string[] = [];
  const byChat = new Map<string, SearchItem[]>();
  for (const item of items) {
    const list = byChat.get(item.chatJid);
    if (list === undefined) {
      byChat.set(item.chatJid, [item]);
      order.push(item.chatJid);
    } else {
      list.push(item);
    }
  }
  return order.map((chatJid) => ({
    chatJid,
    title: titles.get(chatJid) ?? chatJid,
    items: byChat.get(chatJid) ?? [],
  }));
}

/**
 * The `Group › Topic` breadcrumb for a hit (web shows the same). A topic the
 * store has not loaded still shows under its JID, never a private name: the
 * server only returns hits the viewer may see.
 */
export function searchResultTitle(chatTitle: string, topicName?: string): string {
  return topicName === undefined ? chatTitle : `${chatTitle} › ${topicName}`;
}

/** The search page size, web's `limit: 20`. */
export const MESSAGE_SEARCH_LIMIT = 20;
