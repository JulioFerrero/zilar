import type { Block } from '@zilar/protocol';

// T-1872: a card's media are ids, never URLs. These helpers let the server
// check that every id in a card belongs to this AI in this chat, and let the
// paths that cannot fetch media drop the blocks that would carry one.

// The media ids a checked card carries: image items, a file's media and the
// map image of a place or an event.
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

// Drops `images` and `file` blocks and the `map` key of `place` and `event`
// blocks from raw block objects. Anything else is kept unchanged, so the
// normal validation still reports the usual reason for a broken card.
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
