import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { EventBlock } from './EventBlock';
import { PlaceBlock } from './PlaceBlock';
import { WeatherBlock } from './WeatherBlock';

/**
 * The content group's one dispatch point: `place` (21), `weather` (22) and
 * `event` (23). The bodies follow the board
 * `docs/design/mockups/blocks/WebContent.dc.html`.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'place' | 'weather' | 'event' }>,
): ReactNode {
  switch (block.kind) {
    case 'place':
      return <PlaceBlock block={block} />;
    case 'weather':
      return <WeatherBlock block={block} />;
    case 'event':
      return <EventBlock block={block} />;
  }
}
