import { compactNumber, linePath } from '@zilar/chat-core';
import type { LineBlock as LineBlockData } from '@zilar/protocol';

const WIDTH = 320;
const HEIGHT = 110;
const PAD = 4;
const GRIDLINES = [0.25, 0.5, 0.75].map((fraction) => `M0 ${fraction * HEIGHT}H${WIDTH}`).join('');

function lastPoint(path: string): { x: number; y: number } | null {
  const match = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/.exec(path);
  return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
}

export function LineBlock({ block, showHeading }: { block: LineBlockData; showHeading: boolean }) {
  const path = linePath(block.points, WIDTH, HEIGHT - PAD * 2, block.min, block.max);
  const area = path === '' ? '' : `${path} L ${WIDTH} ${HEIGHT - PAD} L 0 ${HEIGHT - PAD} Z`;
  const marker = lastPoint(path);
  const bounds =
    block.min !== undefined && block.max !== undefined ? { min: block.min, max: block.max } : null;
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Line chart';
  return (
    <>
      {showHeading && (block.title !== undefined || block.value !== undefined) && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <span className="min-w-0 flex-1 truncate">{block.title ?? ''}</span>
          {block.value !== undefined && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#ededed]">
              {block.value}
            </span>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <svg
          className="h-[110px] w-full"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={aria}
        >
          <path
            d={GRIDLINES}
            stroke="#1f1f1f"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <g transform={`translate(0 ${PAD})`}>
            {area !== '' && <path d={area} fill="rgba(237,237,237,.06)" />}
            <path
              d={path}
              fill="none"
              stroke="#ededed"
              strokeWidth={1.6}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {marker !== null && <circle cx={marker.x} cy={marker.y} r={3} fill="#ededed" />}
          </g>
        </svg>
        {bounds !== null && (
          <div className="flex flex-col justify-between pt-[14px] pb-[12px] font-mono text-[10px] text-[#8a8a8a] tabular-nums">
            <span className="text-right">{compactNumber(bounds.max)}</span>
            <span className="text-right">{compactNumber(bounds.min)}</span>
          </div>
        )}
      </div>
      {block.labels !== undefined && (
        <div
          className={
            bounds !== null
              ? 'flex justify-between pr-[34px] font-mono text-[10px] text-[#8a8a8a]'
              : 'flex justify-between font-mono text-[10px] text-[#8a8a8a]'
          }
        >
          {block.labels.map((label, index) => (
            <span key={`${label}-${index}`} className="min-w-0 truncate">
              {label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
