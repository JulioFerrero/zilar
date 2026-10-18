import { getShareExtensionKey } from 'expo-share-intent';

import { webPathToAppPath } from '@/lib/web-link';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // The link only carries its payload key; the payload itself sits in the native module, which `/share` reads.
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return '/share';
  }
  return webPathToAppPath(path);
}
