import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { BarsBlock } from './BarsBlock';
import { GaugeBlock } from './GaugeBlock';
import { LineBlock } from './LineBlock';

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board `docs/design/mockups/blocks/WebNumbers.dc.html`.
 */
export function renderChartBlock(
  block: Extract<Block, { kind: 'bars' | 'line' | 'gauge' }>,
): ReactNode {
  switch (block.kind) {
    case 'bars':
      return <BarsBlock block={block} />;
    case 'line':
      return <LineBlock block={block} />;
    case 'gauge':
      return <GaugeBlock block={block} />;
  }
}
