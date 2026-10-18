import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

import { ToolsApiError, type AiToolsApi, type Routine } from '@/lib/tools-api';

export const ROUTINE_NEEDS_APPROVAL_MESSAGE =
  'This routine needs re-approval. Ask the AI to schedule it again.';

export const ROUTINE_FORBIDDEN_MESSAGE = 'You may not change this routine.';

export const ROUTINE_UPDATE_FAILED_MESSAGE = 'Could not update the routine. Try again.';

export type RoutineActionMessage = {
  kind: 'hint' | 'error';
  text: string;
};

export type RoutineAction = 'pause' | 'resume' | 'delete';

/** A `needs_approval` answer is a hint, 403/404 is the forbidden line, anything else the generic line; never the server text. */
export function routineActionMessage(error: unknown): RoutineActionMessage {
  if (error instanceof ToolsApiError && error.code === 'needs_approval') {
    return { kind: 'hint', text: ROUTINE_NEEDS_APPROVAL_MESSAGE };
  }
  if (error instanceof ToolsApiError && (error.status === 403 || error.status === 404)) {
    return { kind: 'error', text: ROUTINE_FORBIDDEN_MESSAGE };
  }
  return { kind: 'error', text: ROUTINE_UPDATE_FAILED_MESSAGE };
}

export type RoutineActionOutcome = {
  routines: Routine[];
  action: RoutineActionMessage | null;
};

/** A failure keeps the list with the fixed message. A new call clears the previous message (success carries `action: null`). */
export const applyRoutineActionEffect = (
  api: AiToolsApi,
  routines: Routine[],
  id: string,
  action: RoutineAction,
): Effect.Effect<RoutineActionOutcome> =>
  (action === 'delete'
    ? Effect.tryPromise({ try: () => api.deleteRoutine(id), catch: (cause) => cause }).pipe(
        Effect.map((): RoutineActionOutcome => ({
          routines: routines.filter((routine) => routine.id !== id),
          action: null,
        })),
      )
    : Effect.tryPromise({
        try: () => (action === 'pause' ? api.pauseRoutine(id) : api.resumeRoutine(id)),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((updated): RoutineActionOutcome => ({
          routines: routines.map((routine) => (routine.id === id ? updated : routine)),
          action: null,
        })),
      )
  ).pipe(
    Effect.catch((error) => Effect.succeed({ routines, action: routineActionMessage(error) })),
  );

export const applyRoutineAction = (
  api: AiToolsApi,
  routines: Routine[],
  id: string,
  action: RoutineAction,
): Promise<RoutineActionOutcome> =>
  Effect.runPromise(applyRoutineActionEffect(api, routines, id, action));

export type RoutineRowActions = {
  busyId: string | null;
  confirmingId: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
};

export type RoutineActions = RoutineRowActions & {
  action: RoutineActionMessage | null;
};

export function useRoutineActions({
  api,
  routines,
  onRoutines,
}: {
  api: AiToolsApi;
  routines: Routine[];
  onRoutines: (routines: Routine[]) => void;
}): RoutineActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [action, setAction] = useState<RoutineActionMessage | null>(null);

  // The action folds into the latest list through the refs: the closure's props would go stale while the call is in flight.
  const routinesRef = useRef(routines);
  useEffect(() => {
    routinesRef.current = routines;
  }, [routines]);

  const onRoutinesRef = useRef(onRoutines);
  useEffect(() => {
    onRoutinesRef.current = onRoutines;
  }, [onRoutines]);

  const runningRef = useRef(false);

  const run = (id: string, routineAction: RoutineAction): void => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusyId(id);
    setAction(null);
    Effect.runFork(
      applyRoutineActionEffect(api, routinesRef.current, id, routineAction).pipe(
        Effect.flatMap((outcome) =>
          Effect.sync(() => {
            onRoutinesRef.current(outcome.routines);
            setAction(outcome.action);
            setConfirmingId(null);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            runningRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
  };

  return {
    busyId,
    confirmingId,
    action,
    onPause: (id) => run(id, 'pause'),
    onResume: (id) => run(id, 'resume'),
    onAskDelete: (id) => {
      setAction(null);
      setConfirmingId(id);
    },
    onConfirmDelete: (id) => run(id, 'delete'),
    onCancelDelete: () => setConfirmingId(null),
  };
}
