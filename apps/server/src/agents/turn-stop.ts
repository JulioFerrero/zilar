// effect-plain: the Promise edge over the turn deps' `finishProgress`, split
// out of `dm-tool-turn.ts` (with the stop helpers) so neither turn file grows
// past the 400-line cap.
// T-1422: the shared stop helpers for the DM and group turns. A stop ends the
// turn quietly: no reply goes out, and the task card gets its one last
// `stopped` correction.
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { redactError } from './tool-exec';

export type TurnDeps = DmTurnDeps | GroupTurnDeps;

/** True once the turn's abort signal has fired. */
export function turnStopped(deps: TurnDeps): boolean {
  return deps.signal?.aborted === true;
}

// T-1414: closes the turn's task card, best effort. A throw never fails the
// turn: it warns with the AI id only, never content.
export async function finishProgressQuietly(
  deps: TurnDeps,
  secrets: string[],
  state: 'done' | 'failed' | 'stopped',
): Promise<void> {
  // T-1426: a stop is a step of its own, so the session log reports it too.
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
