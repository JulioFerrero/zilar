import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/**
 * The data group's one dispatch point: `stats` (03) and `table` (04). The bodies
 * follow the board `docs/design/mockups/blocks/WebNumbers.dc.html`; until that
 * task lands this returns `null` for every kind, exactly like an unknown one.
 */
export function renderDataBlock(block: Extract<Block, { kind: 'stats' | 'table' }>): ReactNode {
  switch (block.kind) {
    case 'stats':
    case 'table':
      return null;
  }
}
