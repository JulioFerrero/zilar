import { eventWhen } from '@zilar/chat-core';
import type { EventBlock as EventBlockData } from '@zilar/protocol';

// The raised date tile of the boards (`WebContent.dc.html:166`).
const TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 0 rgba(0,0,0,.95)',
};

/** 23 · EVENT: a date tile, the title and the time range in the viewer's zone. */
export function EventBlock({ block }: { block: EventBlockData }) {
  // The times are formatted in the zone the viewer is in, which is exactly what
  // an ISO timestamp has to be shown as (`eventWhen`).
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = eventWhen(block.startAt, block.endAt, timeZone);
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-[12px]"
        style={TILE}
      >
        <span className="font-mono text-[10px] text-[#a1a1a1]">{when.month}</span>
        <span className="font-mono text-[20px] leading-6 font-semibold tabular-nums">
          {when.day}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.title}</span>
        <span className="text-[12px] text-[#a1a1a1]">
          {when.line}
          {block.detail !== undefined && ` · ${block.detail}`}
        </span>
      </div>
    </div>
  );
}
