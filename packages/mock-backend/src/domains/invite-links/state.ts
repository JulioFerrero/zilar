import type { MockData } from '../../state';
import { seedInviteLinks, seedInviteTokens } from './seed';

/**
 * The invite-link table plus the shown-once token map, the per-link join-attempt
 * window and the id sequence. Rows are cloned from the seed, so a caller's seed
 * is never changed and `reset()` rebuilds cleanly.
 */
export function createInviteLinksState(): Partial<MockData> {
  return {
    inviteLinks: seedInviteLinks().map((link) => ({ ...link })),
    inviteTokens: new Map(Object.entries(seedInviteTokens())),
    joinAttempts: new Map<string, number>(),
    nextInviteLinkSequence: 1,
  };
}
