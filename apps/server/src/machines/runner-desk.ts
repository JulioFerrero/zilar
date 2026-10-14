import type { DeskServer } from '@zilar/runner-tunnel';
import type { RunnerDesk } from '../hands/runner-hands';

/**
 * T-1423: binds the tunnel's desk server to one runner, so the hub can hand a
 * turn a `RunnerDesk` that never carries (or leaks) the runner id.
 */
export function bindRunnerDesk(desk: DeskServer, runnerId: string): RunnerDesk {
  return {
    sendDesk: (frame) => desk.sendDesk(runnerId, frame),
    openDeskExec: (deskId) => desk.openDeskExec(runnerId, deskId),
  };
}
