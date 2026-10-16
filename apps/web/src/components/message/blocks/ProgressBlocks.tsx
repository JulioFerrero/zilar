import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { CountdownBlock } from './CountdownBlock';
import { ProgressBlock } from './ProgressBlock';
import { TimelineBlock } from './TimelineBlock';

/**
 * The progress group's one dispatch point: `progress` (09), `timeline` (10) and
 * `countdown` (11). The bodies follow the board
 * `docs/design/mockups/blocks/WebProgress.dc.html`.
 */
export function renderProgressBlock(
  block: Extract<Block, { kind: 'progress' | 'timeline' | 'countdown' }>,
): ReactNode {
  switch (block.kind) {
    case 'progress':
      return <ProgressBlock block={block} />;
    case 'timeline':
      return <TimelineBlock block={block} />;
    case 'countdown':
      return <CountdownBlock block={block} />;
  }
}
