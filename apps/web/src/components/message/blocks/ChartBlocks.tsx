import { barHeights, compactNumber, gaugeArc, linePath } from '@zilar/chat-core';
import type {
  BarsBlock as BarsBlockData,
  GaugeBlock as GaugeBlockData,
  LineBlock as LineBlockData,
} from '@zilar/protocol';

const ARCS = { box: 80, radius: 32, stroke: 9, size: 76 };

const BAR =
  'w-full rounded-t-[6px] rounded-b-[3px] bg-[linear-gradient(180deg,#333,#1c1c1c)] shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_1px_0_rgba(0,0,0,.9)]';
const BAR_CURRENT =
  'w-full rounded-t-[6px] rounded-b-[3px] bg-[linear-gradient(180deg,#fff,#c8c8c8)] shadow-[inset_0_1px_0_#fff,0_1px_0_rgba(0,0,0,.9)]';

const TRACK_HEIGHT = 120;
const PEAK_HEIGHT = 87;

const WIDTH = 320;
const HEIGHT = 110;
const PAD = 4;
const GRIDLINES = [0.25, 0.5, 0.75].map((fraction) => `M0 ${fraction * HEIGHT}H${WIDTH}`).join('');

function lastPoint(path: string): { x: number; y: number } | null {
  const match = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/.exec(path);
  return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
}

export function GaugeBlock({ block }: { block: GaugeBlockData }) {
  const percent = Math.round(block.ratio * 100);
  return (
    <div className="flex flex-row items-center gap-4">
      <svg
        className="shrink-0"
        width={ARCS.size}
        height={ARCS.size}
        viewBox={`0 0 ${ARCS.box} ${ARCS.box}`}
        role="img"
        aria-label={`${block.label}, ${percent} percent used`}
      >
        <circle
          cx={ARCS.box / 2}
          cy={ARCS.box / 2}
          r={ARCS.radius}
          fill="none"
          stroke="#0c0c0c"
          strokeWidth={ARCS.stroke}
        />
        <path
          d={gaugeArc(block.ratio, ARCS.radius)}
          transform={`translate(${ARCS.box / 2} ${ARCS.box / 2})`}
          fill="none"
          stroke="#ededed"
          strokeWidth={ARCS.stroke}
          strokeLinecap="round"
        />
        <text
          x={ARCS.box / 2}
          y={45}
          textAnchor="middle"
          className="font-mono"
          fontSize={15}
          fill="#ededed"
        >
          {percent}%
        </text>
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="truncate text-[13px] text-[#a1a1a1]">{block.label}</span>
        <span className="truncate font-mono text-[18px] leading-[26px] tabular-nums">
          {block.value}
        </span>
        {block.caption !== undefined && (
          <span className="truncate text-[12px] text-[#8a8a8a]">{block.caption}</span>
        )}
        {block.detail !== undefined && (
          <span className="truncate text-[12px] text-[#8a8a8a]">{block.detail}</span>
        )}
      </div>
    </div>
  );
}

export function BarsBlock({ block, showHeading }: { block: BarsBlockData; showHeading: boolean }) {
  const heights = barHeights(block.series, PEAK_HEIGHT);
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Bar chart';
  return (
    <>
      {showHeading && (block.title !== undefined || block.value !== undefined) && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <span className="min-w-0 flex-1 truncate">{block.title ?? ''}</span>
          {block.value !== undefined && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums">{block.value}</span>
          )}
        </div>
      )}
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
