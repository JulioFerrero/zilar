import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockRoutine } from './seed';

/**
 * The routines table. Rows are cloned from the seed so a caller-supplied seed is
 * never changed; pause, resume and delete mutate the live rows in place.
 */
export function createRoutinesState(seed: MockSeed): Partial<MockData> {
  const routines: MockRoutine[] = seed.routines.map((routine) => ({
    ...routine,
    approvedHosts: [...routine.approvedHosts],
  }));
  return { routines };
}
