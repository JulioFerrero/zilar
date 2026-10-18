import type { Progress } from '@zilar/protocol';
import { Check, ChevronRight, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import { Effect, Fiber, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { listAis, stopAiTurn } from '@/lib/api/ais';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';
import { formatClock } from '@/lib/format-duration';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { StepStateIcon } from './StepsPanel';

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

/**
 * The task card: one collapsed line (state icon, title, elapsed) that expands
 * to the step checklist and the summary. Without `steps` it falls back to the
 * old `stage`/`detail` shape, so an old server still renders (T-1419).
 *
 * T-1811: `readOnly` draws a card the viewer does not own — the topic Join
 * preview. It keeps the checklist but never offers Stop and never reads the
 * viewer's AI list.
 */
export function ProgressCard({
  progress,
  readOnly = false,
}: {
  progress: Progress;
  readOnly?: boolean;
}) {
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
  // T-1811: a read-only card skips that read entirely.
  const chatJid = useChatSelector((state) => state.activeChatId);
  const [ownedResult] = useQuery(
    () =>
      readOnly
        ? Effect.succeed(null)
        : fromApi(() => listAis()).pipe(
            Effect.map((list) => list.find((ai) => ai.jid === progress.ai) ?? null),
          ),
    [progress.ai, readOnly],
  );
  const ownedAi = AsyncResult.isSuccess(ownedResult) ? ownedResult.value : null;
  const stoppable =
    !readOnly && isLive(progress.state) && progress.can_stop === true && ownedAi !== null;
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

  // A finished card is one line: clicking it opens the Steps panel for the
  // viewer's own AI, or toggles the inline checklist otherwise. A working card
  // only toggles its checklist.
  const finished = !isLive(progress.state);
  const actable = finished ? canViewSteps || expandable : expandable;
  const activate = (): void => {
    if (finished && canViewSteps) {
      viewSteps();
      return;
    }
    setExpanded((open) => !open);
  };

  const header = (
    <>
      <StateIcon state={progress.state} reduceMotion={reduceMotion} />
      <span className="min-w-0 flex-1 line-clamp-2 text-[14px] font-medium">
        {progress.title ?? progress.stage}
      </span>
      {elapsed !== undefined && (
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatClock(elapsed)}
        </span>
      )}
    </>
  );

  return (
    <div className="bubble-in min-w-[220px] rounded-[12px] p-2.5">
      {/* T-1422: the Stop button sits at the right of the collapsed line; the
          expand control and the button are siblings, never nested buttons. */}
      <div className="flex items-center gap-2">
        {actable ? (
          <button
            type="button"
            onClick={activate}
            aria-expanded={expanded}
            aria-label={finished ? 'View steps' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {header}
            {finished && (
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
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

      {expandable
        ? expanded && (
            <div className="mt-2 flex flex-col gap-1.5">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2">
                  <StepStateIcon
                    state={step.state}
                    reduceMotion={reduceMotion}
                    className="size-3.5"
                  />
                  <span className="min-w-0 flex-1 text-[13px] text-foreground">{step.label}</span>
                </div>
              ))}
              {progress.summary !== undefined && (
                <p className="mt-1 text-[13px] text-muted-foreground">{progress.summary}</p>
              )}
            </div>
          )
        : isLive(progress.state) && (
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
