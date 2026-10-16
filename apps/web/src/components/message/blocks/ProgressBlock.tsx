import { ratioPercent } from '@zilar/chat-core';
import type { ProgressBlock as ProgressBlockData } from '@zilar/protocol';
import { CloudUpload } from 'lucide-react';

// The board's recessed track (`WebProgress.dc.html:25`) and its raised fill
// (`:26`); the well recipe of D24, drawn at the board's 8 px height (`:72`).
const TRACK_SHADOW = 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)';
const FILL_GRADIENT = 'linear-gradient(180deg,#f5f5f5,#b5b5b5)';

/** 09 · PROGRESS: one bar with the label, the percent and an optional detail and note. */
export function ProgressBlock({ block }: { block: ProgressBlockData }) {
  const percent = ratioPercent(block.ratio);
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
        <CloudUpload className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{block.label}</span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#ededed]">
          {percent}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={block.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number.parseInt(percent, 10)}
        className="h-2 overflow-hidden rounded-full bg-[#0c0c0c]"
        style={{ boxShadow: TRACK_SHADOW }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: percent, background: FILL_GRADIENT }}
        />
      </div>
      {(block.detail !== undefined || block.note !== undefined) && (
        <div className="flex justify-between gap-3 text-[12px] text-[#8a8a8a]">
          {block.detail !== undefined && (
            <span className="min-w-0 shrink-0 font-mono tabular-nums">{block.detail}</span>
          )}
          {block.note !== undefined && (
            <span className="ml-auto min-w-0 truncate">{block.note}</span>
          )}
        </div>
      )}
    </>
  );
}
