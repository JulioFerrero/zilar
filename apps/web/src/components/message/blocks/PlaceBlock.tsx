import type { PlaceBlock as PlaceBlockData } from '@zilar/protocol';
import { Navigation } from 'lucide-react';
import { BLOCK_KEY } from './blockKey';

export function PlaceBlock({ block }: { block: PlaceBlockData }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.title}</span>
        {block.subtitle !== undefined && (
          <span className="text-[12px] text-[#a1a1a1]">{block.subtitle}</span>
        )}
      </div>
      {block.url !== undefined && (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-[14px] text-[14px] font-medium text-[#ededed]"
          style={BLOCK_KEY}
        >
          <Navigation className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Directions
        </a>
      )}
    </div>
  );
}
