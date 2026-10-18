import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { CountdownBlock } from './CountdownBlock';
import { ProgressBlock } from './ProgressBlock';
import { TimelineBlock } from './TimelineBlock';

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
