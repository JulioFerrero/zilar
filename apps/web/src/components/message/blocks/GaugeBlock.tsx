import { gaugeArc } from '@zilar/chat-core';
import type { GaugeBlock as GaugeBlockData } from '@zilar/protocol';

const ARCS = { box: 80, radius: 32, stroke: 9, size: 76 };

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
