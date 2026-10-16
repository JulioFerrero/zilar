import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { StatsBlock } from '@/components/chat/blocks/stats-block';
import { TableBlock } from '@/components/chat/blocks/table-block';

/** The kinds the data group draws on the phone. */
export const DATA_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>(['stats', 'table']);

/**
 * The data group's one dispatch point: `stats` (03) and `table` (04). The bodies
 * follow the board `docs/design/mockups/blocks/PhoneNumbers.dc.html`.
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
