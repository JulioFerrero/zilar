import type { PublicAi } from '../../lib/ais-api';

/**
 * `disabled` AIs (provisioning in flight) offer neither: the row already says "Setting up" and the buttons would race the server.
 */
export type RunAction = 'stop' | 'resume';

export function runAction(ai: Pick<PublicAi, 'status'>): RunAction | null {
  if (ai.status === 'active') {
    return 'stop';
  }
  if (ai.status === 'stopped') {
    return 'resume';
  }
  return null;
}
