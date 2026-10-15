import type { Progress, ProgressStep } from '@zilar/protocol';
import { Check, ChevronRight, Circle, CircleAlert, LoaderCircle, Square, X } from 'lucide-react';
import { Effect, Fiber, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { listAis, stopAiTurn } from '@/lib/api/ais';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';

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

  // T-1422: the Stop button shows only for a working card the viewer can stop:
  // the server set `can_stop`, and the AI belongs to the viewer (its JID is in
  // the viewer's own `GET /api/ais` list). The chat id is the open chat's.
  const chatJid = useChatSelector((state) => state.activeChatId);
  const [ownedResult] = useQuery(
    () =>
      fromApi(() => listAis()).pipe(
        Effect.map((list) => list.find((ai) => ai.jid === progress.ai) ?? null),
      ),
    [progress.ai],
  );
  const ownedAi = AsyncResult.isSuccess(ownedResult) ? ownedResult.value : null;
  const stoppable = isLive(progress.state) && progress.can_stop === true && ownedAi !== null;
  // The card the stop was tapped on: "Stopping…" lasts until the next edit
  // arrives, which changes `progress` and clears this.
  const [stoppedFor, setStoppedFor] = useState<Progress | null>(null);
  const stopping = stoppedFor === progress;
  const stop = (): void => {
    if (ownedAi === null || chatJid === undefined || stopping) {
      return;
    }
    setStoppedFor(progress);
    void stopAiTurn(ownedAi.id, chatJid).catch(() => {
      // The card's next edit never came; let the owner try again.
      setStoppedFor(null);
    });
  };

  // T-1535: a finished card whose AI is the viewer's own opens the Steps panel.
  // The panel's task id rides the URL, so it survives a reload and needs no
  // store state.
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewSteps =
    progress.task_id !== undefined && !isLive(progress.state) && ownedAi !== null;
  const viewSteps = (): void => {
    if (progress.task_id === undefined) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('steps', progress.task_id);
    setSearchParams(next, { replace: true });
  };

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
      {/* T-1422: the Stop button sits at the right of the collapsed line; the
          expand control and the button are siblings, never nested buttons. */}
      <div className="flex items-center gap-2">
        {expandable ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {header}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
        )}
        {stoppable && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            aria-label={stopping ? 'Stopping' : 'Stop task'}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <Square className="size-3.5" aria-hidden="true" />
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

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

      {canViewSteps && (
        <button
          type="button"
          onClick={viewSteps}
          className="mt-2 flex w-full items-center gap-1.5 border-t border-divider pt-2 text-left text-[13px] font-medium"
        >
          <span className="min-w-0 flex-1">View steps</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
