// The blocks seed (T-1067): no rows, like web's mock (`blockedUsers: []`).

import type { MockSeed } from '../../data';

export function seedBlocksTable(): Partial<MockSeed> {
  return { blockedUsers: [] };
}
