import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { ApiError } from '@/lib/api';
import type { ApiFailure } from '@/lib/effect/errors';
import {
  failureOf,
  isWaiting,
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

/** The last typed failure of a call, hidden while a new call runs. */
function shownFailure<A>(state: ActionState<A, ApiFailure>): ApiFailure | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/** Clears the failure an earlier call left; a call that is still running is not interrupted. */
export function clearFailure<A>(state: ActionState<A, ApiFailure>, controls: ActionControls): void {
  if (!isWaiting(state)) {
    controls.reset();
  }
}

/**
 * The text machineErrorMessage gives for an API answer. fromApi keeps an
 * ApiError's code, status and message; any other throw became the generic
 * unknown_error, which shows the fallback sentence instead.
 */
export function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || failure.code === 'unknown_error') {
    return fallback;
  }
  return machineErrorMessage(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

/**
 * One machine row action: `useAction` plus the failure text its card shows.
 * `error` is null until the last call has failed, so a row with two actions
 * can prefer one action's text over the other's.
 */
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
