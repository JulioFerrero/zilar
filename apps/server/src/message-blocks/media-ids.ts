import type { Block } from '@zilar/protocol';

// A card's media are ids, never URLs. These helpers let the server check that
// every id belongs to this AI in this chat, and let paths that cannot fetch
// media drop the blocks that would carry one.

export function mediaIdsOf(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'images':
        ids.push(...block.items);
        break;
      case 'file':
        ids.push(block.media);
        break;
      case 'place':
      case 'event':
        if (block.map !== undefined) {
          ids.push(block.map);
        }
        break;
      default:
        break;
    }
  }
  return ids;
}

// Drops `images`, `file` and the `map` key of `place`/`event`; anything else is
// kept, so validation still reports the usual reason for a broken card.
export function withoutMedia(blocks: unknown[]): unknown[] {
  const kept: unknown[] = [];
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) {
      kept.push(block);
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record.kind === 'images' || record.kind === 'file') {
      continue;
    }
    if (record.kind === 'place' || record.kind === 'event') {
      const rest = { ...record };
      delete rest.map;
      kept.push(rest);
      continue;
    }
    kept.push(block);
  }
  return kept;
}
