import type { StatsBlock as StatsBlockData } from '@zilar/protocol';
import { Server } from 'lucide-react';

// The tile of the board (`WebNumbers.dc.html:26`): an inner `#101010` surface
// with a `#1f1f1f` border, a 12 px radius, 10/12 padding and a 6 px gap.
const TILE =
  'flex flex-col gap-[6px] rounded-[12px] border border-[#1f1f1f] bg-[#101010] px-3 py-2.5';

// The ratio bar (board `:27-28`): a recessed well with a raised light fill.
const TRACK =
  'h-[6px] overflow-hidden rounded-full bg-[#0c0c0c] shadow-[inset_0_1px_2px_rgba(0,0,0,.9),0_1px_0_rgba(255,255,255,.05)]';
const FILL = 'h-full rounded-full bg-gradient-to-b from-[#f5f5f5] to-[#b5b5b5]';

/** 03 · STAT TILES: label / value tiles with an optional ratio bar. */
export function StatsBlock({ block }: { block: StatsBlockData }) {
  return (
    <>
      {block.title !== undefined && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Server className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {block.tiles.map((tile, index) => (
          <div key={`${tile.label}-${index}`} className={TILE}>
            <span className="truncate text-[12px] text-[#a1a1a1]">{tile.label}</span>
            <span className="text-left font-mono text-[18px] leading-6 tabular-nums">
              {tile.value}
            </span>
            {/* A tile without a ratio keeps the 6 px bar slot so the row stays even. */}
            {tile.ratio === undefined ? (
              <span className="h-[6px]" aria-hidden="true" />
            ) : (
              <div className={TRACK}>
                {/* The ratio is 0-1; a rounded percentage keeps the style clean. */}
                <div
                  className={FILL}
                  style={{ width: `${Number((tile.ratio * 100).toFixed(2))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
