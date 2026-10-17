import { getShareExtensionKey } from 'expo-share-intent';

import { webPathToAppPath } from '@/lib/web-link';

/**
 * Rewrites a system path (an Android App Link, a `zilar://` deep link or the
 * share extension's `dataUrl` link) onto the matching expo-router route before
 * the router handles it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // The share extension's link only carries its payload key; the payload
  // itself sits in the native module, which the `/share` screen reads.
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return '/share';
  }
  return webPathToAppPath(path);
}
