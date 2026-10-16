import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board `docs/design/mockups/blocks/WebNumbers.dc.html`;
 * until that task lands this returns `null` for every kind.
 */
export function renderChartBlock(
  block: Extract<Block, { kind: 'bars' | 'line' | 'gauge' }>,
): ReactNode {
  switch (block.kind) {
    case 'bars':
    case 'line':
    case 'gauge':
      return null;
  }
}
