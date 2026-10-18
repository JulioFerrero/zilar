import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import {
  deleteRoutine,
  listAiRoutines,
  listGroupRoutines,
  pauseRoutine,
  resumeRoutine,
  type Routine,
} from '@/lib/tools';
import { describeRoutineSchedule, pausedReasonText } from '@zilar/chat-core';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '@/components/ui/state-message';

type RoutineWork = 'pause' | 'resume' | 'delete';

interface Notice {
  readonly error: string;
  readonly hint: string;
}

function statusText(routine: Routine): string {
  if (routine.status === 'needs_approval') {
    return 'needs approval';
  }
  if (routine.status === 'paused') {
    return 'paused';
  }
  return 'active';
}

function nextRunText(routine: Routine): string {
  return `next ${new Date(routine.nextRunAt).toLocaleString()}`;
}

function lastStatusText(routine: Routine): string {
  if (routine.lastStatus === null) {
    return 'never run';
  }
  const at = routine.lastRunAt === null ? '' : ` · ${new Date(routine.lastRunAt).toLocaleString()}`;
  return `last ${routine.lastStatus}${at}`;
}

function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || (failure.status === 0 && failure.code === 'unknown_error')) {
    return fallback;
  }
  return failure.message;
}

/**
 * A failure that parses as "no such scope" reads as an empty list (older
 * server or a strict fetch mock), so the section never adds noise. Any other
 * failure stays the inline error with Retry.
 */
function loadRoutines(
  scope: { aiId: string } | { groupId: string },
): Effect.Effect<Routine[], ApiFailure> {
  const call = (): Promise<Routine[]> =>
    'aiId' in scope ? listAiRoutines(scope.aiId) : listGroupRoutines(scope.groupId);
  return fromApi(call).pipe(
    Effect.catchIf(
      (failure) => failure.status === 404 || failure.code === 'invalid_response',
      () => Effect.succeed([]),
    ),
  );
}

function routineCall(
  work: RoutineWork,
  id: string,
): Effect.Effect<Routine | undefined, ApiFailure> {
  if (work === 'pause') {
    return fromApi(() => pauseRoutine(id));
  }
  if (work === 'resume') {
    return fromApi(() => resumeRoutine(id));
  }
  return fromApi(() => deleteRoutine(id)).pipe(Effect.map(() => undefined));
}

function noticeOf(failure: ApiFailure): Notice {
  if (failure.code === 'needs_approval') {
    return {
      error: '',
      hint: 'This routine needs re-approval. Ask the AI to schedule it again.',
    };
  }
  if (failure.status === 403 || failure.status === 404) {
    return { error: 'You may not change this routine.', hint: '' };
  }
  return { error: failureText(failure, 'Could not update the routine.'), hint: '' };
}

export function RoutinesSection({
  scope,
  scopeKey,
  canManage,
  onCount,
}: {
  scope: { aiId: string } | { groupId: string };
  scopeKey: string;
  canManage: boolean;
  onCount?: (count: number) => void;
}) {
  const [list, reloadList] = useQuery(() => loadRoutines(scope), [scopeKey]);
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>({ error: '', hint: '' });

  const startAction = (): void => {
    setBusy(true);
    setNotice({ error: '', hint: '' });
  };
  const settleAction = (): void => {
    setBusy(false);
    setConfirmingId(null);
  };

  const loading = isWaiting(list) || AsyncResult.isInitial(list);
  const failure = AsyncResult.isFailure(list) && !loading ? failureOf(list) : undefined;
  const status: 'loading' | 'ready' | 'error' = loading
    ? 'loading'
    : AsyncResult.isFailure(list)
      ? 'error'
      : 'ready';
  const routines = status === 'ready' && AsyncResult.isSuccess(list) ? list.value : [];

  useEffect(() => {
    if (status === 'ready') {
      onCount?.(routines.length);
    }
  }, [status, routines.length, onCount]);

  return (
    <section aria-label="Routines" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Routines</h2>
      {status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{failureText(failure, 'Could not load the routines.')}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => reloadList()}
          >
            Retry
          </Button>
        </div>
      )}
      {status === 'ready' && routines.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No routines here yet. Ask the AI in the chat to schedule one.
        </p>
      )}
      {status === 'ready' &&
        routines.map((routine) => (
          <RoutineRow
            key={`${scopeKey}:${routine.id}`}
            routine={routine}
            canManage={canManage}
            anyBusy={busy}
            confirming={confirmingId === routine.id}
            onAskDelete={() => setConfirmingId(routine.id)}
            onCancelDelete={() => setConfirmingId(null)}
            onStart={startAction}
            onSettled={settleAction}
            onNotice={setNotice}
          />
        ))}
      {notice.error !== '' && <FieldError>{notice.error}</FieldError>}
      {notice.hint !== '' && (
        <p className="px-2 text-[13px] text-muted-foreground">{notice.hint}</p>
      )}
    </section>
  );
}

/**
 * A deleted row returns nothing but stays mounted: the parent's settle step
 * still runs to the end, and an unmount would cancel it.
 */
function RoutineRow({
  routine: loaded,
  canManage,
  anyBusy,
  confirming,
  onAskDelete,
  onCancelDelete,
  onStart,
  onSettled,
  onNotice,
}: {
  routine: Routine;
  canManage: boolean;
  anyBusy: boolean;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onStart: () => void;
  onSettled: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [current, setCurrent] = useState(loaded);
  const [removed, setRemoved] = useState(false);
  const [state, perform] = useAction((work: RoutineWork) =>
    routineCall(work, loaded.id).pipe(
      Effect.tap((updated) =>
        Effect.sync(() => {
          if (updated === undefined) {
            setRemoved(true);
          } else {
            setCurrent(updated);
          }
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => onNotice(noticeOf(failure)))),
      Effect.ensuring(Effect.sync(onSettled)),
    ),
  );
  if (removed) {
    return null;
  }

  const busy = isWaiting(state);
  const start = (work: RoutineWork): void => {
    if (busy) {
      return;
    }
    onStart();
    perform(work);
  };
  const explanation = pausedReasonText(current.pausedReason, current.status);

  return (
    <div className="flex flex-col gap-1 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{current.title}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {describeRoutineSchedule(current.schedule)} · runs{' '}
            {current.kind === 'prompt' ? 'a prompt' : current.toolName} · {statusText(current)}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {nextRunText(current)} · {lastStatusText(current)}
          </p>
          {explanation !== null && (
            <p className="text-[12px] text-muted-foreground">{explanation}</p>
          )}
        </div>
        {canManage &&
          (current.status === 'active' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Pause ${current.title}`}
              className="shrink-0"
              disabled={anyBusy}
              onClick={() => start('pause')}
            >
              {busy ? 'Pausing…' : 'Pause'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Resume ${current.title}`}
              className="shrink-0"
              disabled={anyBusy}
              onClick={() => start('resume')}
            >
              {busy ? 'Resuming…' : 'Resume'}
            </Button>
          ))}
        {canManage &&
          (confirming ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                aria-label={`Confirm deleting ${current.title}`}
                disabled={anyBusy}
                onClick={() => start('delete')}
              >
                {busy ? 'Deleting…' : 'Delete'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={anyBusy}
                onClick={onCancelDelete}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Delete ${current.title}`}
              className="shrink-0"
              disabled={anyBusy}
              onClick={onAskDelete}
            >
              Delete
            </Button>
          ))}
      </div>
    </div>
  );
}
