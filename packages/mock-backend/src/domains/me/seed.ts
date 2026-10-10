import type { MockSeed } from '../../data';
import { defaultMe } from '../../data/people';

/** The viewer row the seed starts from (`GET`/`PATCH /me` serve it). */
export function seedMe(): Partial<MockSeed> {
  return { me: defaultMe() };
}
