/**
 * Pure helpers for the sticker screen: the reorder arithmetic and the panel
 * membership set, covered by Vitest without a simulator.
 */

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

export function panelIdSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}
