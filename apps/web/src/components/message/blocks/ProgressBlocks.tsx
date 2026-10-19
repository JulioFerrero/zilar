import { countdownParts, pad, ratioPercent } from '@zilar/chat-core';
import type {
  CountdownBlock as CountdownBlockData,
  ProgressBlock as ProgressBlockData,
  TimelineBlock as TimelineBlockData,
} from '@zilar/protocol';
import { Effect, Fiber, Schedule } from 'effect';
import { Clock, CloudUpload, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const TILE_SHADOW = 'inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)';

const TRACK_SHADOW = 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)';
const FILL_GRADIENT = 'linear-gradient(180deg,#f5f5f5,#b5b5b5)';

type Step = TimelineBlockData['steps'][number];

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

function DoneMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="7" fill="#ededed" />
      <path
        d="M4.9 8.3l2.1 2.1 4.1-4.5"
        stroke="#0a0a0a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CurrentMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="7" fill="none" stroke="#ededed" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3" fill="#ededed" />
    </svg>
  );
}

function TodoMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="#0c0c0c" stroke="#2a2a2a" strokeWidth="1.5" />
    </svg>
  );
}

export function ProgressBlock({
  block,
  showHeading,
}: {
  block: ProgressBlockData;
  showHeading: boolean;
}) {
  const percent = ratioPercent(block.ratio);
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <CloudUpload className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.label}</span>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#ededed]">
            {percent}
          </span>
        </div>
      )}
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
    // interrupting the fiber on unmount stops it.
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

export function TimelineBlock({
  block,
  showHeading,
}: {
  block: TimelineBlockData;
  showHeading: boolean;
}) {
  return (
    <>
      {showHeading && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#a1a1a1]">
          <Package className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
      )}
      <div className="flex flex-col">
        {block.steps.map((step: Step, index) => {
          const last = index === block.steps.length - 1;
          return (
            <div key={`${step.label}-${index}`} className="flex gap-3">
              <div className="flex w-3.5 shrink-0 flex-col items-center">
                {step.state === 'done' ? <DoneMark /> : null}
                {step.state === 'current' ? <CurrentMark /> : null}
                {step.state === 'todo' ? <TodoMark /> : null}
                {!last && (
                  <span
                    className="w-0.5 flex-1"
                    style={{
                      minHeight: 22,
                      background: step.state === 'done' ? '#ededed' : '#2a2a2a',
                    }}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-grow flex-col gap-0.5 pb-3">
                <div className="flex min-w-0 justify-between gap-3">
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      step.state === 'current' && 'font-medium',
                      step.state === 'todo' && 'text-[#8a8a8a]',
                    )}
                  >
                    {step.label}
                  </span>
                  {step.at !== undefined && (
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#8a8a8a]">
                      {step.at}
                    </span>
                  )}
                </div>
                {step.detail !== undefined && (
                  <span className="text-[12px] text-[#a1a1a1]">{step.detail}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
