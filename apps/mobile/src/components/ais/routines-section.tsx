import { useEffect, useState } from 'react';
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
import { ToolsApiError, type Routine, type ToolsApi } from '@/lib/tools-api';

/** Fixed user-facing line when the routines list fails to load. */
export const ROUTINES_LOAD_FAILED_MESSAGE = 'Could not load the routines. Try again.';

export const ROUTINES_EMPTY_MESSAGE =
  'No routines here yet. Ask the AI in the chat to schedule one.';

export type RoutinesSectionState = {
  status: 'loading' | 'ready' | 'error';
  routines: Routine[];
  message: string;
};

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

function RoutineRow({ routine }: { routine: Routine }) {
  const explanation = pausedReasonText(routine.pausedReason, routine.status);
  return (
    <View className="gap-1 px-2 py-1.5">
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
  );
}

/**
 * The ready/loading/error body of the routines list, split out so tests can
 * render each state without mounting the loading effect.
 */
export function RoutinesSectionContent({
  state,
  onRetry,
}: {
  state: RoutinesSectionState;
  onRetry: () => void;
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
        <RoutineRow key={routine.id} routine={routine} />
      ))}
    </>
  );
}

/**
 * The Routines section of the AI edit screen (T-0189, read only): every
 * routine with title, schedule in plain words, next run, last status, and
 * the paused reason with its explanation line.
 */
export function RoutinesSection({ api, aiId }: { api: ToolsApi; aiId: string }) {
  const [state, setState] = useState<RoutinesSectionState>({
    status: 'loading',
    routines: [],
    message: '',
  });
  const [reloadTick, setReloadTick] = useState(0);

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

  return (
    <View accessibilityLabel="Routines" className="gap-1">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Routines</Text>
      <RoutinesSectionContent state={state} onRetry={() => setReloadTick((tick) => tick + 1)} />
    </View>
  );
}
