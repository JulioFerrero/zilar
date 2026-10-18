// effect-plain: the stop helpers stay Promise-shaped over the turn deps.
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { redactError } from './tool-exec';

export type TurnDeps = DmTurnDeps | GroupTurnDeps;

/** True once the turn's abort signal has fired. */
export function turnStopped(deps: TurnDeps): boolean {
  return deps.signal?.aborted === true;
}

export async function finishProgressQuietly(
  deps: TurnDeps,
  secrets: string[],
  state: 'done' | 'failed' | 'stopped',
): Promise<void> {
  if (state === 'stopped') deps.log?.append('status', { stage: 'stopped' });
  try {
    await deps.finishProgress?.(state);
  } catch (error) {
    deps.logger.warn(
      { aiId: deps.aiId, err: redactError(error, secrets) },
      'AI task card could not be finished',
    );
  }
}

/** Closes the card as `stopped` and returns the quiet outcome. */
export async function stoppedTurn(deps: TurnDeps, secrets: string[]): Promise<DmTurnOutcome> {
  await finishProgressQuietly(deps, secrets, 'stopped');
  return { kind: 'stopped', text: '' };
}
