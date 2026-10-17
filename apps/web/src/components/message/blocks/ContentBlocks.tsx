import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { EventBlock } from './EventBlock';
import { FileBlock } from './FileBlock';
import { ImagesBlock } from './ImagesBlock';
import { PlaceBlock } from './PlaceBlock';
import { WeatherBlock } from './WeatherBlock';

/**
 * The content group's one dispatch point: `place` (21), `weather` (22),
 * `event` (23), `images` (20) and `file` (24). The bodies follow the board
 * `docs/design/mockups/blocks/WebContent.dc.html`. Content kinds keep their own
 * title when the card has a header, because the title is their content; the
 * images tiles use it as their accessible name.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'place' | 'weather' | 'event' | 'images' | 'file' }>,
  _showHeading: boolean,
  title?: string,
): ReactNode {
  switch (block.kind) {
    case 'place':
      return <PlaceBlock block={block} />;
    case 'weather':
      return <WeatherBlock block={block} />;
    case 'event':
      return <EventBlock block={block} />;
    case 'images':
      return <ImagesBlock block={block} title={title} />;
    case 'file':
      return <FileBlock block={block} />;
  }
}
