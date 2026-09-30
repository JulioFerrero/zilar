/**
 * Rules-of-hooks guard for the chat screens (T-0112 review): Expo Router
 * bundles every file under `src/app`, so a test living there cannot use
 * `node:fs` (Metro fails the export build). The check itself is therefore a
 * pure function over source text, tested with inline sources below.
 */

const HOOK_CALL = /(useEffect|useState|useMemo|useCallback|useRef|useContext)\s*\(/g;

/**
 * Returns the hook calls that appear after `marker` in `source` (e.g. the
 * `if (!chat)` early return). Empty means every hook runs on every render.
 */
export function hooksAfterMarker(source: string, marker: string): string[] {
  const index = source.indexOf(marker);
  if (index === -1) {
    return [`marker not found: ${marker}`];
  }
  return source.slice(index).match(HOOK_CALL) ?? [];
}
