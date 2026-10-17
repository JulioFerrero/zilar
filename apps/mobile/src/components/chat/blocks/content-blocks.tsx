import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';

import { EventBlock } from '@/components/chat/blocks/event-block';
import { FileBlock } from '@/components/chat/blocks/file-block';
import { ImagesBlock } from '@/components/chat/blocks/images-block';
import { PlaceBlock } from '@/components/chat/blocks/place-block';
import { WeatherBlock } from '@/components/chat/blocks/weather-block';

/** The kinds the content group draws on the phone: `images` (20), `place`
 * (21), `weather` (22), `event` (23) and `file` (24). */
export const CONTENT_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'images',
  'place',
  'weather',
  'event',
  'file',
]);

/**
 * The content group's one dispatch point: `images` (20), `place` (21),
 * `weather` (22), `event` (23) and `file` (24). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneContent.dc.html`.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'images' | 'place' | 'weather' | 'event' | 'file' }>,
  _showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'images':
      return <ImagesBlock block={block} />;
    case 'place':
      return <PlaceBlock block={block} />;
    case 'weather':
      return <WeatherBlock block={block} />;
    case 'event':
      return <EventBlock block={block} />;
    case 'file':
      return <FileBlock block={block} />;
  }
}
