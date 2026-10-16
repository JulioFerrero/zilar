import { changeTone, sparklinePath, type BlockTone } from '@zilar/chat-core';
import type { Change, NumberBlock as NumberBlockData } from '@zilar/protocol';

// The change colours of the boards (up `#4ade80`, down `#f87171`); the tone also
// colours the sparkline, which the boards draw in the change's colour.
const CHANGE_COLOR: Record<BlockTone, string> = {
  positive: '#4ade80',
  negative: '#f87171',
  neutral: '#ededed',
  warning: '#fbbf24',
  info: '#ededed',
};

const CHANGE_ARROW: Record<Change['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

/** 02 · BIG NUMBER: one large value, an optional change and sparkline. */
export function NumberBlock({ block }: { block: NumberBlockData }) {
  const tone = block.change === undefined ? 'neutral' : changeTone(block.change);
  const color = CHANGE_COLOR[tone];
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <span className="min-w-0 flex-1 truncate">{block.label}</span>
        {block.code !== undefined && (
          <span className="shrink-0 font-mono text-[12px] text-[#a1a1a1]">{block.code}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[30px] leading-9 font-medium tracking-[-0.02em] tabular-nums">
          {block.value}
        </span>
        {block.change !== undefined && (
          <span className="font-mono text-[13px] tabular-nums" style={{ color }}>
            {CHANGE_ARROW[block.change.direction] ?? '—'} {block.change.text}
          </span>
        )}
      </div>
      {block.points !== undefined && (
        <svg
          className="h-10 w-full"
          viewBox="0 0 360 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={sparklinePath(block.points, 360, 40)}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </>
  );
}
