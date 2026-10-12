import type { MockSeed } from '../../data';
import type { MockMe } from '../../data/people';
import type { MockData } from '../../state';

/** The viewer row plus the picture url the avatar routes set; `GET /me` carries it. */
type MeRow = MockMe & { avatarUrl?: string | undefined; bio: string };

/**
 * The me slice. The bio (T-1258) is owned here rather than in the shared
 * `MockMe`, so this domain folder is the only place that changes: the route
 * reads the setter through this type, and `GET /me` serves `me` with the bio.
 */
export interface MeState {
  readonly me: MeRow;
  renameMe(name: string): void;
  setMeHandle(handle: string): void;
  setMeBio(bio: string): void;
  setMeAvatarUrl(url: string | undefined): void;
}

/** The viewer table; every mutator copies the row so a caller's read stays consistent. */
export function createMeState(seed: MockSeed): Partial<MockData> {
  let me: MeRow = { ...seed.me, bio: '' };
  const state: MeState = {
    get me(): MeRow {
      return me;
    },
    renameMe(name: string): void {
      me = { ...me, name };
    },
    setMeHandle(handle: string): void {
      me = { ...me, handle };
    },
    setMeBio(bio: string): void {
      me = { ...me, bio };
    },
    setMeAvatarUrl(url: string | undefined): void {
      me = { ...me, avatarUrl: url };
    },
  };
  return state;
}
