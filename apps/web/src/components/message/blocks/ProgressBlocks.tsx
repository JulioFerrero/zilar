import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/**
 * The progress group's one dispatch point: `progress` (08), `timeline` (09) and
 * `countdown` (10). The bodies follow the board
 * `docs/design/mockups/blocks/WebProgress.dc.html`; until that task lands this
 * returns `null` for every kind.
 */
export function renderProgressBlock(
  block: Extract<Block, { kind: 'progress' | 'timeline' | 'countdown' }>,
): ReactNode {
  switch (block.kind) {
    case 'progress':
    case 'timeline':
    case 'countdown':
      return null;
  }
}
