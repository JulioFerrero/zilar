import type { MockSeed } from '../../data';
import type { MockMe } from '../../data/people';
import type { MockData } from '../../state';

/** The viewer row plus the picture url the avatar routes set; `GET /me` carries it. */
type MeRow = MockMe & { avatarUrl?: string | undefined };

/** The viewer table; every mutator copies the row so a caller's read stays consistent. */
export function createMeState(seed: MockSeed): Partial<MockData> {
  let me: MeRow = { ...seed.me };
  return {
    get me(): MockMe {
      return me;
    },
    renameMe(name: string): void {
      me = { ...me, name };
    },
    setMeHandle(handle: string): void {
      me = { ...me, handle };
    },
    setMeAvatarUrl(url: string | undefined): void {
      me = { ...me, avatarUrl: url };
    },
  };
}
