import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import {
  describeRoutineSchedule,
  nextRunText,
  pausedReasonText,
  routineLastText,
  routineStatusText,
} from '@/lib/routines-format';
import { ToolsApiError, type AiToolsApi, type Routine, type ToolsApi } from '@/lib/tools-api';

/** Fixed user-facing line when the routines list fails to load. */
export const ROUTINES_LOAD_FAILED_MESSAGE = 'Could not load the routines. Try again.';

export const ROUTINES_EMPTY_MESSAGE =
  'No routines here yet. Ask the AI in the chat to schedule one.';

/** The hint under the list when the server says the routine needs re-approval. */
export const ROUTINE_NEEDS_APPROVAL_MESSAGE =
  'This routine needs re-approval. Ask the AI to schedule it again.';

/** The error under the list when the server refuses the change. */
export const ROUTINE_FORBIDDEN_MESSAGE = 'You may not change this routine.';

/** The error under the list for any other action failure. Never server text. */
export const ROUTINE_UPDATE_FAILED_MESSAGE = 'Could not update the routine. Try again.';

export type RoutinesSectionState = {
  status: 'loading' | 'ready' | 'error';
  routines: Routine[];
  message: string;
};

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

/**
 * Loads one AI's routines. A 404 or an unparseable response reads as an
 * empty list, not an error (web does the same); any other failure throws.
 */
export async function loadAiRoutines(api: ToolsApi, aiId: string): Promise<Routine[]> {
  try {
    return await api.listAiRoutines(aiId);
  } catch (error) {
    if (
      error instanceof ToolsApiError &&
      (error.status === 404 || error.code === 'invalid_response')
    ) {
      return [];
    }
    throw error;
  }
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
export async function applyRoutineAction(
  api: AiToolsApi,
  routines: Routine[],
  id: string,
  action: RoutineAction,
): Promise<RoutineActionOutcome> {
  try {
    if (action === 'delete') {
      await api.deleteRoutine(id);
      return {
        routines: routines.filter((routine) => routine.id !== id),
        action: null,
      };
    }
    const updated = action === 'pause' ? await api.pauseRoutine(id) : await api.resumeRoutine(id);
    return {
      routines: routines.map((routine) => (routine.id === id ? updated : routine)),
      action: null,
    };
  } catch (error) {
    return { routines, action: routineActionMessage(error) };
  }
}

export type RoutineRowActions = {
  busyId: string | null;
  confirmingId: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
};

function RoutineRow({ routine, actions }: { routine: Routine; actions?: RoutineRowActions }) {
  const explanation = pausedReasonText(routine.pausedReason, routine.status);
  const busy = actions?.busyId === routine.id;
  const busyAny = actions?.busyId !== null && actions?.busyId !== undefined;
  const confirming = actions?.confirmingId === routine.id;
  return (
    <View className="gap-1 px-2 py-1.5">
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="min-w-0 flex-1">
          <Text className="truncate text-[14px] font-medium">{routine.title}</Text>
          <Text className="truncate text-[12px] text-muted-foreground">
            {describeRoutineSchedule(routine.schedule)} · runs {routine.toolName} ·{' '}
            {routineStatusText(routine)}
          </Text>
          <Text className="truncate text-[12px] text-muted-foreground">
            {nextRunText(routine)} · {routineLastText(routine)}
          </Text>
          {explanation !== null ? (
            <Text className="text-[12px] text-muted-foreground">{explanation}</Text>
          ) : null}
        </View>
        {actions === undefined ? null : routine.status === 'active' ? (
          <Button
            variant="outline"
            size="sm"
            accessibilityLabel={`Pause ${routine.title}`}
            disabled={busyAny}
            onPress={() => actions.onPause(routine.id)}
            className="shrink-0"
          >
            <Text>{busy ? 'Pausing…' : 'Pause'}</Text>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            accessibilityLabel={`Resume ${routine.title}`}
            disabled={busyAny}
            onPress={() => actions.onResume(routine.id)}
            className="shrink-0"
          >
            <Text>{busy ? 'Resuming…' : 'Resume'}</Text>
          </Button>
        )}
        {actions === undefined ? null : confirming ? (
          <View className="flex-row shrink-0 items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              accessibilityLabel={`Confirm deleting ${routine.title}`}
              disabled={busyAny}
              onPress={() => actions.onConfirmDelete(routine.id)}
            >
              <Text>{busy ? 'Deleting…' : 'Delete'}</Text>
            </Button>
            <Button variant="ghost" size="sm" disabled={busyAny} onPress={actions.onCancelDelete}>
              <Text>Cancel</Text>
            </Button>
          </View>
        ) : (
          <Button
            variant="outline"
            size="sm"
            accessibilityLabel={`Delete ${routine.title}`}
            disabled={busyAny}
            onPress={() => actions.onAskDelete(routine.id)}
            className="shrink-0"
          >
            <Text>Delete</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

/**
 * The ready/loading/error body of the routines list, split out so tests can
 * render each state without mounting the loading effect.
 */
export function RoutinesSectionContent({
  state,
  onRetry,
  actions,
  action,
}: {
  state: RoutinesSectionState;
  onRetry: () => void;
  actions?: RoutineRowActions;
  action?: RoutineActionMessage | null;
}) {
  if (state.status === 'loading') {
    return <Text className="px-2 text-[13px] text-muted-foreground">Loading…</Text>;
  }
  if (state.status === 'error') {
    return (
      <View className="gap-2 px-2">
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {state.message}
        </Text>
        <Button variant="outline" onPress={onRetry} className="self-start">
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }
  if (state.routines.length === 0) {
    return <Text className="px-2 text-[13px] text-muted-foreground">{ROUTINES_EMPTY_MESSAGE}</Text>;
  }
  return (
    <>
      {state.routines.map((routine) => (
        <RoutineRow key={routine.id} routine={routine} actions={actions} />
      ))}
      {action !== undefined && action !== null ? (
        action.kind === 'hint' ? (
          <Text className="px-2 text-[13px] text-muted-foreground">{action.text}</Text>
        ) : (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {action.text}
          </Text>
        )
      ) : null}
    </>
  );
}

/**
 * The Routines section of the AI edit screen (T-0189 list, T-0212 actions):
 * every routine with title, schedule in plain words, next run, last status,
 * the paused reason with its explanation line, and Pause/Resume/Delete.
 * While an action runs every action button is disabled; failures show one
 * fixed line under the list (never server text).
 */
export function RoutinesSection({ api, aiId }: { api: AiToolsApi; aiId: string }) {
  const [state, setState] = useState<RoutinesSectionState>({
    status: 'loading',
    routines: [],
    message: '',
  });
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [action, setAction] = useState<RoutineActionMessage | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const routines = await loadAiRoutines(api, aiId);
        if (!active) return;
        setState({ status: 'ready', routines, message: '' });
      } catch {
        if (!active) return;
        setState({ status: 'error', routines: [], message: ROUTINES_LOAD_FAILED_MESSAGE });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, aiId, reloadTick]);

  const routinesRef = useRef(state.routines);
  // The running action folds into the latest list through the ref: the
  // closure's `state` would go stale while the call is in flight.
  useEffect(() => {
    routinesRef.current = state.routines;
  }, [state.routines]);

  const runningRef = useRef(false);

  const run = (id: string, routineAction: RoutineAction): void => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusyId(id);
    setAction(null);
    void (async () => {
      try {
        const outcome = await applyRoutineAction(api, routinesRef.current, id, routineAction);
        setState((current) => ({ ...current, routines: outcome.routines }));
        setAction(outcome.action);
        setConfirmingId(null);
      } finally {
        runningRef.current = false;
        setBusyId(null);
      }
    })();
  };

  const actions: RoutineRowActions = {
    busyId,
    confirmingId,
    onPause: (id) => run(id, 'pause'),
    onResume: (id) => run(id, 'resume'),
    onAskDelete: (id) => {
      setAction(null);
      setConfirmingId(id);
    },
    onConfirmDelete: (id) => run(id, 'delete'),
    onCancelDelete: () => setConfirmingId(null),
  };

  return (
    <View accessibilityLabel="Routines" className="gap-1">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Routines</Text>
      <RoutinesSectionContent
        state={state}
        onRetry={() => setReloadTick((tick) => tick + 1)}
        actions={actions}
        action={action}
      />
    </View>
  );
}
