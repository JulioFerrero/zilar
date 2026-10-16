import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

/** The kinds the content group draws on the phone; empty until its task lands. */
export const CONTENT_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>();

/**
 * The content group's one dispatch point: `weather` (22) and `event` (23). The
 * bodies follow the board `docs/design/mockups/blocks/PhoneContent.dc.html`;
 * until that task lands this returns `null` for every kind.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'weather' | 'event' }>,
  _showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'weather':
    case 'event':
      return null;
  }
}
