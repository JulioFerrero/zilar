/** How long message search waits after the last keystroke before searching. */
export const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

/** How long GIF search waits after the last keystroke before searching. */
export const GIF_SEARCH_DEBOUNCE_MS = 300;

/** How long people search waits after the last keystroke before looking up. */
export const PEOPLE_SEARCH_DEBOUNCE_MS = 900;

/** How long the people prefix search waits after the last keystroke. */
export const PEOPLE_PREFIX_DEBOUNCE_MS = 300;

/** The server searches people from 3 characters on, after one leading `@`. */
export const PEOPLE_SEARCH_MIN_LENGTH = 3;

/** The search contract caps `q` at 64 characters. */
export const USER_SEARCH_MAX_LENGTH = 64;

/** The server needs at least 2 characters; shorter text never searches. */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;

/** The message-search page size. */
export const MESSAGE_SEARCH_LIMIT = 20;

/** The query text that searches, or null when it is too short to send. */
export function activeQuery(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.length >= MESSAGE_SEARCH_MIN_LENGTH ? trimmed : null;
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

export interface SearchGroup<T> {
  chatJid: string;
  title: string;
  items: T[];
}

/**
 * Groups hits by chat, newest group first (the server already answers newest
 * first, so first-seen order is newest-first). A chat the store has not
 * loaded falls back to its JID, never a guess.
 */
export function groupSearchByChat<T extends { chatJid: string }>(
  items: readonly T[],
  titles: ReadonlyMap<string, string>,
): SearchGroup<T>[] {
  const order: string[] = [];
  const byChat = new Map<string, T[]>();
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
 * The `Group › Topic` breadcrumb for a hit. A topic the store has not loaded
 * still shows under its JID, never a private name: the server only returns
 * hits the viewer may see.
 */
export function searchResultTitle(chatTitle: string, topicName?: string): string {
  return topicName === undefined ? chatTitle : `${chatTitle} › ${topicName}`;
}

/** Trims, strips one leading `@` and lowercases, exactly like the server. */
export function normalizePeopleQuery(query: string): string {
  const trimmed = query.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}
