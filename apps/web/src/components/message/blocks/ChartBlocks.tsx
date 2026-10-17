import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { BarsBlock } from './BarsBlock';
import { GaugeBlock } from './GaugeBlock';
import { LineBlock } from './LineBlock';

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board `docs/design/mockups/blocks/WebNumbers.dc.html`;
 * bars and line pass `showHeading` through, while a gauge has no heading row.
 */
export function renderChartBlock(
  block: Extract<Block, { kind: 'bars' | 'line' | 'gauge' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'bars':
      return <BarsBlock block={block} showHeading={showHeading} />;
    case 'line':
      return <LineBlock block={block} showHeading={showHeading} />;
    case 'gauge':
      return <GaugeBlock block={block} />;
  }
}
