import type { Progress, ProgressStep } from '@zilar/protocol';
import { Check, Circle, CircleAlert, LoaderCircle, Square, X } from 'lucide-react';
import { Effect, Fiber, Schedule } from 'effect';
import { useEffect, useState } from 'react';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

/** Elapsed as `12s`, `2m 14s` or `1h 05m`. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** A card without a terminal state is still working. */
function isLive(state: Progress['state']): boolean {
  return state === undefined || state === 'working';
}

/**
 * The elapsed to show: the time from `started_at` to now while working, so it
 * ticks; the frozen `elapsed_ms` once the task is over.
 */
function elapsedFor(progress: Progress, now: number): number | undefined {
  const parsed = progress.started_at === undefined ? undefined : Date.parse(progress.started_at);
  const started = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;
  if (isLive(progress.state)) {
    if (started !== undefined) {
      return Math.max(0, now - started);
    }
    return progress.elapsed_ms;
  }
  if (progress.elapsed_ms !== undefined) {
    return progress.elapsed_ms;
  }
  return started === undefined ? undefined : Math.max(0, now - started);
}

/** The state icon of the collapsed line. */
function StateIcon({ state, reduceMotion }: { state: Progress['state']; reduceMotion: boolean }) {
  const className = 'size-4 shrink-0';
  if (state === 'done') {
    return <Check className={cn(className, 'text-accent')} aria-hidden="true" />;
  }
  if (state === 'failed') {
    return <CircleAlert className={cn(className, 'text-danger')} aria-hidden="true" />;
  }
  if (state === 'stopped') {
    return <Square className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
  }
  return (
    <LoaderCircle
      className={cn(
        className,
        'text-accent',
        !reduceMotion && 'animate-spin',
        reduceMotion && 'spinner-reduced',
      )}
      aria-hidden="true"
    />
  );
}

/** The state icon of one checklist row. */
function StepIcon({
  state,
  reduceMotion,
}: {
  state: ProgressStep['state'];
  reduceMotion: boolean;
}) {
  const className = 'size-3.5 shrink-0';
  if (state === 'done') {
    return <Check className={cn(className, 'text-accent')} aria-hidden="true" />;
  }
  if (state === 'failed') {
    return <X className={cn(className, 'text-danger')} aria-hidden="true" />;
  }
  if (state === 'doing') {
    return (
      <LoaderCircle
        className={cn(
          className,
          'text-accent',
          !reduceMotion && 'animate-spin',
          reduceMotion && 'spinner-reduced',
        )}
        aria-hidden="true"
      />
    );
  }
  return <Circle className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
}

/**
 * The task card: one collapsed line (state icon, title, elapsed) that expands
 * to the step checklist and the summary. Without `steps` it falls back to the
 * old `stage`/`detail` shape, so an old server still renders (T-1419).
 */
export function ProgressCard({ progress }: { progress: Progress }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ticking = isLive(progress.state) && progress.started_at !== undefined;

  useEffect(() => {
    if (!ticking) {
      return;
    }
    // A ticking `now` as an Effect fiber per repo rule, no `setInterval`.
    const tick = Effect.sync(() => setNow(Date.now()));
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(1000)).pipe(Effect.delay(1000), Effect.asVoid),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(timer));
    };
  }, [ticking]);

  const elapsed = elapsedFor(progress, now);
  const steps = progress.steps ?? [];
  const expandable = steps.length > 0;

  const header = (
    <>
      <StateIcon state={progress.state} reduceMotion={reduceMotion} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
        {progress.title ?? progress.stage}
      </span>
      {elapsed !== undefined && (
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </span>
      )}
    </>
  );

  return (
    <div className="bubble-in min-w-[220px] rounded-[12px] p-2.5">
      {expandable ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 text-left"
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2">{header}</div>
      )}

      {expandable ? (
        expanded && (
          <div className="mt-2 flex flex-col gap-1.5">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2">
                <StepIcon state={step.state} reduceMotion={reduceMotion} />
                <span className="min-w-0 flex-1 text-[13px] text-foreground">{step.label}</span>
              </div>
            ))}
            {progress.summary !== undefined && (
              <p className="mt-1 text-[13px] text-muted-foreground">{progress.summary}</p>
            )}
          </div>
        )
      ) : (
        <>
          {progress.title !== undefined && (
            <p className="mt-1 text-[13px] text-muted-foreground">{progress.stage}</p>
          )}
          {progress.detail !== undefined && (
            <p className="mt-1 text-[13px] text-muted-foreground">{progress.detail}</p>
          )}
        </>
      )}
    </div>
  );
}
