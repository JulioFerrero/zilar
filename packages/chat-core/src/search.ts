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

/** Trims, strips one leading `@` and lowercases, exactly like the server. */
export function normalizePeopleQuery(query: string): string {
  const trimmed = query.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}
