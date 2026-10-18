import { changeTone, type BlockTone } from '@zilar/chat-core';
import type { Change, FigureBlock as FigureBlockData } from '@zilar/protocol';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

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

export function FigureBlock({ block }: { block: FigureBlockData }) {
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
