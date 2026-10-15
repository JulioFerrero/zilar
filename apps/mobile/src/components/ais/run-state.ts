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
