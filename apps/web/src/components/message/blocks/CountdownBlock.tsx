import { countdownParts } from '@zilar/chat-core';
import type { CountdownBlock as CountdownBlockData } from '@zilar/protocol';
import { Effect, Fiber, Schedule } from 'effect';
import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

// The board's recessed tile (`WebProgress.dc.html:88`): the D24 well recipe at
// the board's 12 px radius and 8 px vertical padding.
const TILE_SHADOW = 'inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)';

// The board prints each tile two digits wide ("02 hours · 14 min · 09 sec").
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function Tile({ value, unit }: { value: number; unit: string }) {
  return (
    <div
      className="flex flex-1 flex-col items-center gap-0.5 rounded-[12px] bg-[#0c0c0c] py-2"
      style={{ boxShadow: TILE_SHADOW }}
    >
      <span className="font-mono text-[26px] leading-8 tabular-nums">{pad(value)}</span>
      <span className="text-[11px] text-[#8a8a8a]">{unit}</span>
    </div>
  );
}

/**
 * 11 · COUNTDOWN: the label and the tiles that tick down to `targetAt`.
 * `showHeading` hides the block's own label row when the card already draws a
 * header.
 */
export function CountdownBlock({
  block,
  showHeading,
}: {
  block: CountdownBlockData;
  showHeading: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A ticking `now` as an Effect fiber per repo rule, not a bare interval;
    // interrupting the fiber on unmount stops it, like ProgressCard.
    const tick = Effect.sync(() => setNow(Date.now()));
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(1000)).pipe(Effect.delay(1000), Effect.asVoid),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(timer));
    };
  }, []);

  const parts = countdownParts(block.targetAt, now);
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.label}</span>
        </div>
      )}
      {parts.past ? (
        // A reached target has no tiles to show: a muted word instead of zeros
        // or negative numbers. "Started" is the closer word — a countdown
        // reaches the moment the awaited thing begins, not the one it ends.
        <span className="text-[12px] text-[#8a8a8a]">Started</span>
      ) : (
        <div className="flex gap-2">
          {parts.days >= 1 && <Tile value={parts.days} unit="days" />}
          <Tile value={parts.hours} unit="hours" />
          <Tile value={parts.minutes} unit="min" />
          <Tile value={parts.seconds} unit="sec" />
        </div>
      )}
      {block.note !== undefined && <span className="text-[12px] text-[#a1a1a1]">{block.note}</span>}
    </>
  );
}
