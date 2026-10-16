import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/**
 * The content group's one dispatch point: `weather` (22) and `event` (23). The
 * bodies follow the board `docs/design/mockups/blocks/WebContent.dc.html`; until
 * that task lands this returns `null` for every kind.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'weather' | 'event' }>,
): ReactNode {
  switch (block.kind) {
    case 'weather':
    case 'event':
      return null;
  }
}
