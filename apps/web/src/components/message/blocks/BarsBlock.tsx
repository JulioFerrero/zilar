import { barHeights } from '@zilar/chat-core';
import type { BarsBlock as BarsBlockData } from '@zilar/protocol';

// The board's bar look (`WebNumbers.dc.html:29-30`): dark raised columns, with
// today's column on the light key gradient. Its value and label are drawn brighter
// too, so the highlight is never colour alone.
const BAR =
  'w-full rounded-t-[6px] rounded-b-[3px] bg-[linear-gradient(180deg,#333,#1c1c1c)] shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_1px_0_rgba(0,0,0,.9)]';
const BAR_CURRENT =
  'w-full rounded-t-[6px] rounded-b-[3px] bg-[linear-gradient(180deg,#fff,#c8c8c8)] shadow-[inset_0_1px_0_#fff,0_1px_0_rgba(0,0,0,.9)]';

// The tallest bar keeps headroom for its value label: the board draws the peak
// at 87% of the 120 px track (`:154-161`).
const TRACK_HEIGHT = 120;
const PEAK_HEIGHT = 87;

/** 05 · BARS: a column per series entry, today's column raised and labelled. */
export function BarsBlock({ block }: { block: BarsBlockData }) {
  const heights = barHeights(block.series, PEAK_HEIGHT);
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Bar chart';
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <span className="min-w-0 flex-1 truncate">{block.title ?? ''}</span>
        {block.value !== undefined && (
          <span className="shrink-0 font-mono text-[12px] tabular-nums">{block.value}</span>
        )}
      </div>
      <div
        role="img"
        aria-label={aria}
        className="flex items-end gap-[10px]"
        style={{ height: TRACK_HEIGHT }}
      >
        {block.series.map((entry, index) => (
          <div
            key={`${entry.label}-${index}`}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span
              className={
                entry.current === true
                  ? 'font-mono text-[10px] tabular-nums text-[#ededed]'
                  : 'font-mono text-[10px] tabular-nums text-[#8a8a8a]'
              }
            >
              {entry.value}
            </span>
            <div
              className={entry.current === true ? BAR_CURRENT : BAR}
              style={{ height: `${heights[index] ?? 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[10px] text-center font-mono text-[10px] text-[#8a8a8a]">
        {block.series.map((entry, index) => (
          <span
            key={`${entry.label}-${index}`}
            className={
              entry.current === true
                ? 'min-w-0 flex-1 truncate text-[#ededed]'
                : 'min-w-0 flex-1 truncate'
            }
          >
            {entry.label}
          </span>
        ))}
      </div>
    </>
  );
}
