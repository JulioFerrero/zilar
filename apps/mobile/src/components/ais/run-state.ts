import type { PublicAi } from '../../lib/ais-api';

/**
 * The kill-switch action (T-0080) offered in the AI list's actions sheet.
 * `active` AIs can be stopped, `stopped` AIs can be resumed, and `disabled`
 * AIs (provisioning in flight) offer neither: the row already says "Setting
 * up" and the buttons would race the server.
 */
export type RunAction = 'stop' | 'resume';

/**
 * Picks the kill-switch action for the AI row's actions sheet. `null` means
 * the sheet should hide the action entirely.
 */
export function runAction(ai: Pick<PublicAi, 'status'>): RunAction | null {
  if (ai.status === 'active') {
    return 'stop';
  }
  if (ai.status === 'stopped') {
    return 'resume';
  }
  return null;
}

/**
 * The visible state label for the AI row. `active` shows nothing (the row is
 * alive and clear), `stopped` gets a clear "Stopped" pill, and `disabled` —
 * provisioning in flight — gets "Setting up" so the owner is not misled into
 * thinking the AI is paused.
 */
export function runStateLabel(status: PublicAi['status']): string {
  if (status === 'stopped') {
    return 'Stopped';
  }
  if (status === 'disabled') {
    return 'Setting up';
  }
  return '';
}
