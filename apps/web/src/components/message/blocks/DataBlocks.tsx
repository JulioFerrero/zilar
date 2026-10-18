import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { StatsBlock } from './StatsBlock';
import { TableBlock } from './TableBlock';

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
