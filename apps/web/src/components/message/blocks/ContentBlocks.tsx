import type { Block } from '@zilar/protocol';
import type { ReactNode } from 'react';
import { EventBlock } from './EventBlock';
import { FileBlock } from './FileBlock';
import { ImagesBlock } from './ImagesBlock';
import { PlaceBlock } from './PlaceBlock';
import { WeatherBlock } from './WeatherBlock';

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
