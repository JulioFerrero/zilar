import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { ApiError } from '@/lib/api';
import type { ApiFailure } from '@zilar/client-core';
import {
  isWaiting,
  shownFailure,
  useAction,
  type ActionControls,
  type ActionState,
  type UseActionOptions,
} from '@/lib/effect/use-action';
import { machineErrorMessage } from '@/components/machines/errors';

export interface ConfirmingState {
  deny: string | null;
  revoke: string | null;
  delete: string | null;
}

export type ConfirmKind = keyof ConfirmingState;

export const EMPTY_CONFIRMING: ConfirmingState = { deny: null, revoke: null, delete: null };

export function clearFailure<A>(state: ActionState<A, ApiFailure>, controls: ActionControls): void {
  if (!isWaiting(state)) {
    controls.reset();
  }
}

export function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || failure.code === 'unknown_error') {
    return fallback;
  }
  return machineErrorMessage(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

export function useMachineAction<I, A>(
  fn: (input: I) => Effect.Effect<A, ApiFailure, HttpClient.HttpClient>,
  fallback: string,
  options?: UseActionOptions,
): readonly [
  state: ActionState<A, ApiFailure>,
  run: (input: I) => void,
  controls: ActionControls,
  error: string | null,
] {
  const [state, run, controls] = useAction(fn, options);
  const failure = shownFailure(state);
  return [state, run, controls, failure === undefined ? null : failureText(failure, fallback)];
}
