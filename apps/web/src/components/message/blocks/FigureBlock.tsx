import { changeTone, type BlockTone } from '@zilar/chat-core';
import type { Change, FigureBlock as FigureBlockData } from '@zilar/protocol';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

// The change colours of the boards: up is `#4ade80`, down is `#f87171`; a flat
// change stays muted. The direction also picks the arrow glyph, because the
// payload only carries the pre-formatted text (T-1755).
const CHANGE_COLOR: Record<BlockTone, string> = {
  positive: '#4ade80',
  negative: '#f87171',
  neutral: '#a1a1a1',
  warning: '#fbbf24',
  info: '#ededed',
};

const CHANGE_ARROW: Record<Change['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

/** 01 · FIGURES: label / value rows with an optional change per row. */
export function FigureBlock({ block }: { block: FigureBlockData }) {
  // The value column stays aligned whichever way it goes: three columns when
  // any row has a change, two otherwise (board `WebNumbers.dc.html:42-46`).
  const hasChange = block.rows.some((row) => row.change !== undefined);
  return (
    <div
      className={cn(
        'grid gap-y-[6px]',
        hasChange ? 'grid-cols-[1fr_auto_auto] gap-x-[14px]' : 'grid-cols-[1fr_auto] gap-x-4',
      )}
    >
      {block.rows.map((row, index) => (
        <Fragment key={`${row.label}-${index}`}>
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="text-right font-mono tabular-nums">{row.value}</span>
          {hasChange && (
            <span
              className="text-right font-mono tabular-nums"
              style={
                row.change === undefined
                  ? undefined
                  : { color: CHANGE_COLOR[changeTone(row.change)] }
              }
            >
              {row.change === undefined
                ? ''
                : `${CHANGE_ARROW[row.change.direction] ?? '—'} ${row.change.text}`}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
