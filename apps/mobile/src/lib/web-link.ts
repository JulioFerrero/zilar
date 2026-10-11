/**
 * Maps a web URL or path from `chat.zilar.app` onto the matching mobile route,
 * so an Android App Link opens the right screen. `zilar://` deep links pass
 * through unchanged.
 *
 * A full `https://chat.zilar.app/...` URL uses the web-to-mobile mapping, and
 * anything unknown goes to `/`. A bare path (one expo-router may hand over
 * without the scheme) is only rewritten for the web-only forms `/c/`, `/j/`
 * and `/@`; every other bare path, such as an existing app route, is returned
 * unchanged with its query, so the app's own deep links keep working.
 */

const APP_HOST = 'chat.zilar.app';

/** The mobile pages under `/settings`; every other page falls back to `/settings`. */
const SETTINGS_PAGES = new Set([
  'approvals',
  'blocked',
  'connections',
  'folders',
  'integrations',
  'machines',
  'profile',
  'requests',
  'stickers',
]);

const URL_PATTERN = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/;

/** A path and its query string (starting with `?`, or empty). */
interface WebTarget {
  path: string;
  search: string;
}

/** The path and query of a `chat.zilar.app` URL, or `undefined` for another host. */
function parseAppLink(input: string): WebTarget | undefined {
  const match = URL_PATTERN.exec(input);
  if (match === null || match[1].split(':')[0] !== APP_HOST) {
    return undefined;
  }
  return { path: match[2] === '' ? '/' : match[2], search: match[3] ?? '' };
}

/** Splits a bare path such as `/settings/sticker-pack?id=p1` at its first `?`. */
function splitSearch(input: string): WebTarget {
  const index = input.indexOf('?');
  if (index < 0) {
    return { path: input, search: '' };
  }
  return { path: input.slice(0, index), search: input.slice(index) };
}

/** Rewrites the web-only forms; any other bare path is kept as it is. */
function rewriteBarePath({ path, search }: WebTarget): string {
  const chat = /^\/c\/(.+)$/.exec(path);
  if (chat) {
    return `/chat/${chat[1]}${search}`;
  }
  const join = /^\/j\/(.+)$/.exec(path);
  if (join) {
    return `/join/${join[1]}${search}`;
  }
  const at = /^\/@(.+)$/.exec(path);
  if (at) {
    return `/at/${at[1]}${search}`;
  }
  return path + search;
}

/** Rewrites a full `chat.zilar.app` URL; unknown web paths go to `/`. */
function rewriteWebUrl({ path, search }: WebTarget): string {
  const chat = /^\/c\/(.+)$/.exec(path);
  if (chat) {
    return `/chat/${chat[1]}${search}`;
  }
  const join = /^\/j\/(.+)$/.exec(path);
  if (join) {
    return `/join/${join[1]}${search}`;
  }
  if (/^\/(?:invite|u)\/.+$/.test(path)) {
    return path + search;
  }
  const at = /^\/@(.+)$/.exec(path);
  if (at) {
    return `/at/${at[1]}${search}`;
  }
  const settings = /^\/settings\/([^/]+)$/.exec(path);
  if (settings) {
    return SETTINGS_PAGES.has(settings[1]) ? `/settings/${settings[1]}${search}` : '/settings';
  }
  return '/';
}

export function webPathToAppPath(input: string): string {
  if (input.startsWith('zilar://')) {
    return input;
  }
  if (input.startsWith('/')) {
    return rewriteBarePath(splitSearch(input));
  }
  const target = parseAppLink(input);
  if (target === undefined) {
    return '/';
  }
  return rewriteWebUrl(target);
}
