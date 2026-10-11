import { webPathToAppPath } from '@/lib/web-link';

/**
 * Rewrites a system path (an Android App Link or a `zilar://` deep link) onto
 * the matching expo-router route before the router handles it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return webPathToAppPath(path);
}
