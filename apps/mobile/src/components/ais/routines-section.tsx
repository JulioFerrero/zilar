import { ApiError } from '@zilar/api-contract';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Effect } from 'effect';

import {
  useRoutineActions,
  type RoutineActionMessage,
  type RoutineRowActions,
} from '@/components/ais/use-routine-actions';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import {
  describeRoutineSchedule,
  nextRunText,
  pausedReasonText,
  routineLastText,
  routineStatusText,
} from '@/lib/routines-format';
import { interruptFiber } from '@zilar/client-core';
import type { AiToolsApi, Routine, ToolsApi } from '@/lib/tools-api';

export {
  routineActionMessage,
  type RoutineAction,
  type RoutineActionMessage,
} from '@/components/ais/use-routine-actions';

export const ROUTINES_LOAD_FAILED_MESSAGE = 'Could not load the routines. Try again.';

export const ROUTINES_EMPTY_MESSAGE =
  'No routines here yet. Ask the AI in the chat to schedule one.';

export type RoutinesSectionState = {
  status: 'loading' | 'ready' | 'error';
  routines: Routine[];
  message: string;
};

/** A 404 or an unparseable response reads as an empty list, not an error (web does the same) */
export const loadAiRoutinesEffect = (api: ToolsApi, aiId: string) =>
  Effect.tryPromise({ try: () => api.listAiRoutines(aiId), catch: (cause) => cause }).pipe(
    Effect.catch((error) =>
      error instanceof ApiError && (error.status === 404 || error.code === 'invalid_response')
        ? Effect.succeed<Routine[]>([])
        : Effect.fail(error),
    ),
  );

function RoutineRow({ routine, actions }: { routine: Routine; actions?: RoutineRowActions }) {
  const explanation = pausedReasonText(routine.pausedReason, routine.status);
  const busy = actions?.busyId === routine.id;
  const busyAny = actions?.busyId !== null && actions?.busyId !== undefined;
  const confirming = actions?.confirmingId === routine.id;
  return (
    <View className="gap-1.5 px-2 py-1.5">
      <View className="min-w-0">
        <Text className="truncate text-[14px] font-medium">{routine.title}</Text>
        <Text className="truncate text-[12px] text-muted-foreground">
          {describeRoutineSchedule(routine.schedule)} · runs{' '}
          {routine.kind === 'prompt' ? 'a prompt' : routine.toolName} · {routineStatusText(routine)}
        </Text>
        <Text className="truncate text-[12px] text-muted-foreground">
          {nextRunText(routine)} · {routineLastText(routine)}
        </Text>
        {explanation !== null ? (
          <Text className="text-[12px] text-muted-foreground">{explanation}</Text>
        ) : null}
      </View>
      <View className="flex-row justify-end gap-2">
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

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="gap-2 px-2">
      <Text accessibilityRole="alert" className="text-[13px] text-danger">
        {message}
      </Text>
      <Button variant="outline" onPress={onRetry} className="self-start">
        <Text>Retry</Text>
      </Button>
    </View>
  );
}

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
    return <StateMessage kind="loading" size="inline" title="Loading…" />;
  }
  if (state.status === 'error') {
    return <SectionError message={state.message} onRetry={onRetry} />;
  }
  if (state.routines.length === 0) {
    return <StateMessage kind="empty" size="inline" title={ROUTINES_EMPTY_MESSAGE} />;
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
 * While an action runs every action button is disabled; failures show one fixed line under the list, never server text.
 */
export function RoutinesSection({ api, aiId }: { api: AiToolsApi; aiId: string }) {
  const [state, setState] = useState<RoutinesSectionState>({
    status: 'loading',
    routines: [],
    message: '',
  });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    // Unmount or a new aiId interrupts the load, so a late answer never lands.
    const load = loadAiRoutinesEffect(api, aiId).pipe(
      Effect.matchEffect({
        onFailure: () =>
          Effect.sync(() =>
            setState({ status: 'error', routines: [], message: ROUTINES_LOAD_FAILED_MESSAGE }),
          ),
        onSuccess: (routines) =>
          Effect.sync(() => setState({ status: 'ready', routines, message: '' })),
      }),
    );
    const fiber = Effect.runFork(load);
    return () => {
      interruptFiber(fiber);
    };
  }, [api, aiId, reloadTick]);

  const actions = useRoutineActions({
    api,
    routines: state.routines,
    onRoutines: (routines) => setState((current) => ({ ...current, routines })),
  });

  return (
    <View accessibilityLabel="Routines" className="gap-1">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Routines</Text>
      <RoutinesSectionContent
        state={state}
        onRetry={() => setReloadTick((tick) => tick + 1)}
        actions={actions}
        action={actions.action}
      />
    </View>
  );
}
