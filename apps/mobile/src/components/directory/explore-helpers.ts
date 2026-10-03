import { DirectoryApiError, type DirectoryEntry } from '@/lib/directory-api';

/**
 * Friendly lines for the explore list (T-0183): raw server text never
 * renders. A stranger opening a share link during an outage sees the retry
 * text, never a dead-link message for a live group.
 */

export type ExploreStatus = 'idle' | 'loading' | 'ready' | 'error';

export function describeDirectoryError(error: unknown, fallback: string): string {
  if (error instanceof DirectoryApiError) {
    // Reads are rate limited (30 per 10 minutes): the 429 names the wait.
    if (error.status === 429 || error.code === 'rate_limited') {
      return 'Too many searches, try again in a few minutes';
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Check your connection and try again.';
    }
    if (error.message !== '') {
      return error.message;
    }
  }
  return fallback;
}

export function describeJoinError(error: unknown): string {
  if (error instanceof DirectoryApiError) {
    switch (error.code) {
      case 'group_full':
        return 'That group is full right now.';
      case 'not_found':
        return 'That group is no longer public.';
      case 'rate_limited':
        return 'Too many joins — wait a little and try again.';
      default:
        break;
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  return 'Could not join. Try again.';
}

/** "42 members" / "1 member", with the channel suffix like the web list. */
export function directorySubtitle(entry: DirectoryEntry): string {
  const members = `${entry.memberCount} ${entry.memberCount === 1 ? 'member' : 'members'}`;
  return entry.kind === 'channel' ? `${members} · Channel` : members;
}

/** "Join" / "Open" for one explore row (pure, so the screen test asserts it). */
export function exploreActionTitle(entry: DirectoryEntry): string {
  return entry.joined ? 'Open' : 'Join';
}
