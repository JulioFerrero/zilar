import { getShareExtensionKey } from 'expo-share-intent';

/**
 * A bare path is rewritten only for the web-only forms `/c/`, `/j/` and `/@`; every other bare path is returned unchanged with its query, so the app's own deep links keep working.
 */

const APP_HOST = 'chat.zilar.app';

const SETTINGS_PAGES = new Set([
  'approvals',
  'blocked',
  'connections',
  'contacts',
  'devices',
  'folders',
  'integrations',
  'machines',
  'profile',
  'requests',
  'stickers',
]);

const URL_PATTERN = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/;

interface WebTarget {
  path: string;
  search: string;
}

function parseAppLink(input: string): WebTarget | undefined {
  const match = URL_PATTERN.exec(input);
  if (match === null || match[1].split(':')[0] !== APP_HOST) {
    return undefined;
  }
  return { path: match[2] === '' ? '/' : match[2], search: match[3] ?? '' };
}

function splitSearch(input: string): WebTarget {
  const index = input.indexOf('?');
  if (index < 0) {
    return { path: input, search: '' };
  }
  return { path: input.slice(0, index), search: input.slice(index) };
}

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

function rewriteWebUrl({ path, search }: WebTarget): string {
  const chat = /^\/c\/(.+)$/.exec(path);
  if (chat) {
    return `/chat/${chat[1]}${search}`;
  }
  const join = /^\/j\/(.+)$/.exec(path);
  if (join) {
    return `/join/${join[1]}${search}`;
  }
  if (/^\/(?:invite|u|stickers)\/.+$/.test(path)) {
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

function webPathToAppPath(input: string): string {
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

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // The link only carries its payload key; the payload itself sits in the native module, which `/share` reads.
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return '/share';
  }
  return webPathToAppPath(path);
}
