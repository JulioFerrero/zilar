import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { EventBlock } from '@/components/chat/blocks/event-block';
import { PlaceBlock } from '@/components/chat/blocks/place-block';
import { WeatherBlock } from '@/components/chat/blocks/weather-block';

/** The kinds the content group draws on the phone: `place` (21), `weather`
 * (22) and `event` (23). */
export const CONTENT_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'place',
  'weather',
  'event',
]);

/**
 * The content group's one dispatch point: `place` (21), `weather` (22) and
 * `event` (23). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneContent.dc.html`.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'place' | 'weather' | 'event' }>,
  _showHeading: boolean,
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
