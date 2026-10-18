import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { BarsBlock } from './BarsBlock';
import { GaugeBlock } from './GaugeBlock';
import { LineBlock } from './LineBlock';

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
