import { Effect } from 'effect';
import type { MachinesApi } from '../../lib/machines-api';
import { runMobile } from '../../lib/effect/runtime';
import { describeMachinesError } from './errors';

export interface MachineChangeOutcome {
  home: string | null;
  error: string;
}

/**
 * The `changeMachine` flow behind the AI edit screen's picker: on success the
 * PUT answer is the shown machine (the server is the source of truth); on
 * failure the previous value is restored and a fixed sentence comes back.
 */
export function applyMachineChange(
  api: MachinesApi,
  aiId: string,
  next: string | null,
  previous: string | null,
): Promise<MachineChangeOutcome> {
  return runMobile(
    Effect.tryPromise({
      try: () => api.setAiMachine(aiId, next),
      catch: (cause: unknown) => cause,
    }).pipe(
      Effect.match({
        onSuccess: (fresh): MachineChangeOutcome => ({ home: fresh, error: '' }),
        onFailure: (cause): MachineChangeOutcome => ({
          home: previous,
          error: describeMachinesError(cause, 'Could not update the home machine.').message,
        }),
      }),
    ),
  );
}
