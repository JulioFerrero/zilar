import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { StatsBlock } from './StatsBlock';
import { TableBlock } from './TableBlock';

/**
 * The data group's one dispatch point: `stats` (03) and `table` (04). The bodies
 * follow the board `docs/design/mockups/blocks/WebNumbers.dc.html`; each passes
 * `showHeading` so a card header never repeats a block title.
 */
export function renderDataBlock(
  block: Extract<Block, { kind: 'stats' | 'table' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'stats':
      return <StatsBlock block={block} showHeading={showHeading} />;
    case 'table':
      return <TableBlock block={block} showHeading={showHeading} />;
  }
}
