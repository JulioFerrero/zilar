import type { Progress } from '@zilar/protocol';
import { Check, ChevronRight, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import { Effect, Fiber, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { listAis, stopAiTurn } from '@/lib/api/ais';
import { fromApi } from '@zilar/client-core';
import { useQuery } from '@/lib/effect/use-query';
import { elapsedFor, formatClock, isLive } from '@zilar/chat-core';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { StepStateIcon } from './StepsPanel';

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
 * Task card: one line expanding to steps; without `steps` it falls back to the
 * old `stage`/`detail` shape. `readOnly` keeps the checklist but never Stop.
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

  // Stop shows only for a working card the server lets the viewer stop and
  // whose AI is in the viewer's own list; a read-only card skips that read.
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
  const [stoppedFor, setStoppedFor] = useState<Progress | null>(null);
  const stopping = stoppedFor === progress;
  const stop = (): void => {
    if (ownedAi === null || chatJid === undefined || stopping) {
      return;
    }
    setStoppedFor(progress);
    void stopAiTurn(ownedAi.id, chatJid).catch(() => {
      setStoppedFor(null);
    });
  };

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
      {/* The expand control and the Stop button stay siblings,
          never nested buttons. */}
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
