/**
 * Pure helpers for the Settings Stickers screen (T-0187): the reorder
 * arithmetic and the panel membership set. Kept hook- and JSX-free so
 * Vitest covers the logic without a simulator.
 */

/** The new panel order after moving one pack; out-of-range moves are no-ops. */
export function movedOrder(ids: readonly string[], packId: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(packId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as string);
  return next;
}

/** The panel pack ids, for marking Discover rows as added or not. */
export function panelIdSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}
