import type { PlaceBlock as PlaceBlockData } from '@zilar/protocol';
import { Navigation } from 'lucide-react';

// The dark secondary key of the boards (`WebContent.dc.html:26,78`).
const KEY = {
  background: 'linear-gradient(180deg,#1c1c1c,#121212)',
  border: '1px solid #2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/**
 * 21 · PLACE: the title, the address line and a Directions key when there is a
 * link. The board's map image is an uploaded media id and is out of scope, so
 * the card is drawn without it.
 */
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
          style={KEY}
        >
          <Navigation className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Directions
        </a>
      )}
    </div>
  );
}
