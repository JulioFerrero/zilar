import type { TimelineBlock as TimelineBlockData } from '@zilar/protocol';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

type Step = TimelineBlockData['steps'][number];

// The marker of a `done` step (`WebProgress.dc.html:110`): a filled disc with a
// dark tick.
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

// The marker of the `current` step (`:118`): a light ring with an inner dot.
function CurrentMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="7" fill="none" stroke="#ededed" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3" fill="#ededed" />
    </svg>
  );
}

// The marker of a `todo` step (`:122`): an empty well disc.
function TodoMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="#0c0c0c" stroke="#2a2a2a" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * 10 · TIMELINE: ordered steps, each marked done, current or todo.
 * `showHeading` hides the block's own title row when the card already draws a
 * header.
 */
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
                {/* The connector runs to the next step: light after a done
                    step, dark otherwise (the board, `:110` vs `:118`). */}
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
