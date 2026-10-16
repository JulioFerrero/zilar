import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

import { ToolsApiError, type AiToolsApi, type Routine } from '@/lib/tools-api';

/**
 * The routine action logic shared by the AI page's `RoutinesSection` and the
 * group's Tools and routines page (T-1740): the fixed messages, the effect
 * that applies one action to the list, and the `useRoutineActions` hook that
 * owns the busy/confirm state and runs one action at a time.
 */

/** The hint under the list when the server says the routine needs re-approval. */
export const ROUTINE_NEEDS_APPROVAL_MESSAGE =
  'This routine needs re-approval. Ask the AI to schedule it again.';

/** The error under the list when the server refuses the change. */
export const ROUTINE_FORBIDDEN_MESSAGE = 'You may not change this routine.';

/** The error under the list for any other action failure. Never server text. */
export const ROUTINE_UPDATE_FAILED_MESSAGE = 'Could not update the routine. Try again.';

export type RoutineActionMessage = {
  kind: 'hint' | 'error';
  text: string;
};

export type RoutineAction = 'pause' | 'resume' | 'delete';

/**
 * Maps an action failure to the fixed user-facing message (T-0212, like
 * web's `mutate` in `RoutinesSection.tsx` but never the server text): a
 * `needs_approval` answer is a hint, 403/404 is the forbidden line, and
 * anything else (including network errors) is the generic line.
 */
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

/**
 * Runs one routine action and folds it into the list: pause/resume swaps
 * the row for the routine the server returned, delete removes the row, and
 * a failure keeps the list with the fixed message. A new call clears the
 * previous message (success carries `action: null`).
 */
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

/** Promise form of `applyRoutineActionEffect`. It never rejects: a failure is the outcome's message. */
export const applyRoutineAction = (
  api: AiToolsApi,
  routines: Routine[],
  id: string,
  action: RoutineAction,
): Promise<RoutineActionOutcome> =>
  Effect.runPromise(applyRoutineActionEffect(api, routines, id, action));

/** The row-level actions a list of routines passes down to each row. */
export type RoutineRowActions = {
  busyId: string | null;
  confirmingId: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
};

/** The hook's answer: the row actions plus the message under the list. */
export type RoutineActions = RoutineRowActions & {
  action: RoutineActionMessage | null;
};

/**
 * The shared routine-row action state (T-1740): one action at a time (a
 * second click while one runs is ignored), the busy row, the row awaiting
 * delete confirmation, and the message under the list. `routines` is the
 * latest list and `onRoutines` receives the list an action produced, so the
 * caller owns where the list lives (component state on the AI page, the
 * loaded query on the group page).
 */
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

  // The running action folds into the latest list through the refs: the
  // closure's props would go stale while the call is in flight.
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
