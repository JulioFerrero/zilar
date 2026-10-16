import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/** The kinds the charts group draws on the phone; empty until its task lands. */
export const CHART_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>();

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneNumbers.dc.html`; until that task lands this
 * returns `null` for every kind.
 */
export function renderChartBlock(
  block: Extract<Block, { kind: 'bars' | 'line' | 'gauge' }>,
  _showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'bars':
    case 'line':
    case 'gauge':
      return null;
  }
}
