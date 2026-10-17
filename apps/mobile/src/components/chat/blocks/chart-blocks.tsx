import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { BarsBlock } from '@/components/chat/blocks/bars-block';
import { GaugeBlock } from '@/components/chat/blocks/gauge-block';
import { LineBlock } from '@/components/chat/blocks/line-block';

/** The kinds the charts group draws on the phone. */
export const CHART_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'bars',
  'line',
  'gauge',
]);

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneNumbers.dc.html`; each passes `showHeading`
 * through like the progress blocks do, except the gauge whose label is part of
 * its row.
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
