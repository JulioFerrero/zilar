import type { TaskStep, TaskStepAction } from '@zilar/api-contract';
import type { Progress } from '@zilar/protocol';

export interface DisplayStep {
  id: string;
  label: string;
  state: TaskStep['state'];
  durationMs: number | null;
  approved: boolean;
  actions: readonly TaskStepAction[];
}

export function toDisplayStep(step: TaskStep): DisplayStep {
  return {
    id: step.id,
    label: step.label,
    state: step.state,
    durationMs: step.durationMs,
    approved: step.approved,
    actions: step.actions,
  };
}

export function fallbackSteps(card: Progress | undefined): DisplayStep[] {
  return (card?.steps ?? []).map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state === 'planned' || step.state === 'doing' ? 'stopped' : step.state,
    durationMs: null,
    approved: false,
    actions: [],
  }));
}

/**
 * The rows the steps view shows: the loaded ones when there are any; the card's own steps
 * when the log is gone or empty; nothing while loading or after another failure.
 */
export function stepsView(
  loaded: readonly TaskStep[] | undefined,
  failureStatus: number | undefined,
  card: Progress | undefined,
): { steps: DisplayStep[]; loading: boolean; errored: boolean } {
  const gone = loaded === undefined ? failureStatus === 404 : loaded.length === 0;
  const steps =
    loaded !== undefined && loaded.length > 0
      ? loaded.map(toDisplayStep)
      : gone
        ? fallbackSteps(card)
        : [];
  return {
    steps,
    loading: loaded === undefined && failureStatus === undefined,
    errored: failureStatus !== undefined && failureStatus !== 404,
  };
}

export function defaultOpenStepId(steps: readonly DisplayStep[]): string | null {
  return steps.find((step) => step.actions.some((action) => !action.ok))?.id ?? null;
}
