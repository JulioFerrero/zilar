import type { MachinesApi } from '../../lib/machines-api';
import { describeMachinesError } from './errors';

export interface MachineChangeOutcome {
  /** The home machine id to show: the PUT answer, or the previous value on failure. */
  home: string | null;
  /** A fixed user-facing sentence, or empty on success. Never raw server text. */
  error: string;
}

/**
 * The `changeMachine` flow behind the AI edit screen's home-machine picker.
 * A pure async step so the screen stays thin and the outcome is unit
 * testable: on success the PUT answer (the server is the source of truth)
 * becomes the shown machine; on failure the previous value is restored and
 * a fixed error sentence comes back.
 */
export async function applyMachineChange(
  api: MachinesApi,
  aiId: string,
  next: string | null,
  previous: string | null,
): Promise<MachineChangeOutcome> {
  try {
    const fresh = await api.setAiMachine(aiId, next);
    return { home: fresh, error: '' };
  } catch (cause: unknown) {
    return {
      home: previous,
      error: describeMachinesError(cause, 'Could not update the home machine.').message,
    };
  }
}
