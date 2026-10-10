import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockBlockedUser } from './tables';

/**
 * The blocks table. Rows are cloned from the seed, so a caller-supplied seed is
 * never changed; a block or unblock replaces the array, never mutates in place.
 */
export function createBlocksState(seed: MockSeed): Partial<MockData> {
  let blockedUsers: MockBlockedUser[] = seed.blockedUsers.map((entry) => ({ ...entry }));
  return {
    get blockedUsers(): readonly MockBlockedUser[] {
      return blockedUsers;
    },
    isBlocked(userId: string): boolean {
      return blockedUsers.some((entry) => entry.userId === userId);
    },
    blockUser(userId: string): void {
      if (!blockedUsers.some((entry) => entry.userId === userId)) {
        blockedUsers = [...blockedUsers, { userId, blockedAt: new Date().toISOString() }];
      }
    },
    unblockUser(userId: string): void {
      blockedUsers = blockedUsers.filter((entry) => entry.userId !== userId);
    },
  };
}
