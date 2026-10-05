import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  deleteRoutine,
  listAiRoutines,
  listGroupRoutines,
  pauseRoutine,
  resumeRoutine,
  type Routine,
} from '@/lib/tools';
import { describeRoutineSchedule, pausedReasonText } from '@/lib/routines';
import { Button, FieldError } from '@/components/ais/AiPageShell';

type ListStatus = 'loading' | 'ready' | 'error';

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

/**
 * The Routines list of an AI or a group (T-0107): title, schedule in
 * plain words, next run, last status, the paused reason with its
 * explanation line, and Pause/Resume/Delete. A routine paused for
 * `hosts_changed` or failures says what to do next (ask the AI to
 * re-approve). Actions the API would refuse hide (`canManage` comes from
 * the caller); a 403/404 from a write shows an inline message, no crash.
 * Resume from `needs_approval` answers 409 and shows the re-approve hint.
 */
export function RoutinesSection({
  scope,
  scopeKey,
  canManage,
}: {
  /** Exactly one of the two lists, matching the server routes. */
  scope: { aiId: string } | { groupId: string };
  scopeKey: string;
  /** False hides Pause/Resume/Delete (a member the API would refuse). */
  canManage: boolean;
}) {
  const [state, setState] = useState<{
    status: ListStatus;
    routines: Routine[];
    message: string;
  }>({ status: 'loading', routines: [], message: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionHint, setActionHint] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // Reset to `loading` while rendering (not inside the effect body): the
  // repo lint forbids setState in an effect body. Same shape as
  // `AlwaysAllowedList`.
  const loadKey = `${scopeKey}#${reloadTick}`;
  const [lastLoadKey, setLastLoadKey] = useState(loadKey);
  if (lastLoadKey !== loadKey) {
    setLastLoadKey(loadKey);
    setState({ status: 'loading', routines: [], message: '' });
  }

  // `scope` is a fresh literal each render; spreading it into the deps
  // would refetch on every render, so `scopeKey` is the stable key and the
  // ref carries the latest scope into the effect body (same shape as
  // `AlwaysAllowedList`).
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = scopeRef.current;
        const routines = await ('aiId' in current
          ? listAiRoutines(current.aiId)
          : listGroupRoutines(current.groupId));
        if (!active) {
          return;
        }
        setState({ status: 'ready', routines, message: '' });
      } catch (error) {
        if (!active) {
          return;
        }
        // A failure that parses as "no such scope" reads as an empty list
        // (older server, or a strict fetch mock answering 404/[] for the
        // new endpoints), so the section never adds noise to the panel.
        // Any other failure shows the inline error with Retry.
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.code === 'invalid_response')
        ) {
          setState({ status: 'ready', routines: [], message: '' });
          return;
        }
        setState({
          status: 'error',
          routines: [],
          message: error instanceof Error ? error.message : 'Could not load the routines.',
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [scopeKey, reloadTick]);

  const mutate = async (
    id: string,
    work: (id: string) => Promise<Routine | void>,
  ): Promise<void> => {
    setBusyId(id);
    setActionError('');
    setActionHint('');
    try {
      const updated = await work(id);
      if (updated === undefined) {
        setState((current) => ({
          ...current,
          routines: current.routines.filter((routine) => routine.id !== id),
        }));
      } else {
        setState((current) => ({
          ...current,
          routines: current.routines.map((routine) => (routine.id === id ? updated : routine)),
        }));
      }
      setConfirmingId(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'needs_approval') {
        setActionHint('This routine needs re-approval. Ask the AI to schedule it again.');
      } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setActionError('You may not change this routine.');
      } else {
        setActionError(error instanceof Error ? error.message : 'Could not update the routine.');
      }
      setConfirmingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const pause = (id: string): Promise<void> => mutate(id, (routineId) => pauseRoutine(routineId));
  const resume = (id: string): Promise<void> => mutate(id, (routineId) => resumeRoutine(routineId));
  const remove = (id: string): Promise<void> => mutate(id, (routineId) => deleteRoutine(routineId));

  return (
    <section aria-label="Routines" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Routines</h2>
      {state.status === 'loading' && (
        <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>
      )}
      {state.status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{state.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => setReloadTick((tick) => tick + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.routines.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No routines here yet. Ask the AI in the chat to schedule one.
        </p>
      )}
      {state.status === 'ready' &&
        state.routines.map((routine) => {
          const explanation = pausedReasonText(routine.pausedReason, routine.status);
          const busy = busyId === routine.id;
          const confirming = confirmingId === routine.id;
          return (
            <div
              key={routine.id}
              className="flex flex-col gap-1 rounded-xl px-2 py-1.5 hover:bg-list-hover"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{routine.title}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {describeRoutineSchedule(routine.schedule)} · runs {routine.toolName} ·{' '}
                    {statusText(routine)}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {nextRunText(routine)} · {lastStatusText(routine)}
                  </p>
                  {explanation !== null && (
                    <p className="text-[12px] text-muted-foreground">{explanation}</p>
                  )}
                </div>
                {canManage &&
                  (routine.status === 'active' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Pause ${routine.title}`}
                      className="shrink-0"
                      disabled={busyId !== null}
                      onClick={() => void pause(routine.id)}
                    >
                      {busy ? 'Pausing…' : 'Pause'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Resume ${routine.title}`}
                      className="shrink-0"
                      disabled={busyId !== null}
                      onClick={() => void resume(routine.id)}
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
                        aria-label={`Confirm deleting ${routine.title}`}
                        disabled={busyId !== null}
                        onClick={() => void remove(routine.id)}
                      >
                        {busy ? 'Deleting…' : 'Delete'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyId !== null}
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Delete ${routine.title}`}
                      className="shrink-0"
                      disabled={busyId !== null}
                      onClick={() => setConfirmingId(routine.id)}
                    >
                      Delete
                    </Button>
                  ))}
              </div>
            </div>
          );
        })}
      {actionError !== '' && <FieldError>{actionError}</FieldError>}
      {actionHint !== '' && <p className="px-2 text-[13px] text-muted-foreground">{actionHint}</p>}
    </section>
  );
}
