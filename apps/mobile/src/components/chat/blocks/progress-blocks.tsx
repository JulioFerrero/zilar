import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { CountdownBlock } from '@/components/chat/blocks/countdown-block';
import { ProgressBlock } from '@/components/chat/blocks/progress-block';
import { TimelineBlock } from '@/components/chat/blocks/timeline-block';

/** The kinds the progress group draws on the phone. */
export const PROGRESS_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'progress',
  'timeline',
  'countdown',
]);

/**
 * The progress group's one dispatch point: `progress` (09), `timeline` (10) and
 * `countdown` (11). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneProgress.dc.html`; each passes `showHeading`
 * through like the status block does.
 */
export function renderProgressBlock(
  block: Extract<Block, { kind: 'progress' | 'timeline' | 'countdown' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'progress':
      return <ProgressBlock block={block} showHeading={showHeading} />;
    case 'timeline':
      return <TimelineBlock block={block} showHeading={showHeading} />;
    case 'countdown':
      return <CountdownBlock block={block} showHeading={showHeading} />;
  }
}
