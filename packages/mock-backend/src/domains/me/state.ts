import type { MockSeed } from '../../data';
import type { MockMe } from '../../data/people';
import type { MockData } from '../../state';

/** The viewer table; `renameMe` is the only mutation this route group needs. */
export function createMeState(seed: MockSeed): Partial<MockData> {
  let me: MockMe = { ...seed.me };
  return {
    get me(): MockMe {
      return me;
    },
    renameMe(name: string): void {
      me = { ...me, name };
    },
  };
}
