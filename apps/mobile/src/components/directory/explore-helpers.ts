import { ApiError } from '@zilar/api-contract';
import type { DirectoryEntry } from '@/lib/directory-api';

/**
 * Friendly lines for the explore list: raw server text never renders. A stranger
 * opening a share link during an outage sees the retry text, never a dead-link
 * message for a live group.
 */

export function describeDirectoryError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') {
      return 'Too many searches, try again in a few minutes';
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  // Never the server's message: it can carry internals ("db timeout on shard
  // 3"). Every other code or status reads the caller fallback.
  return fallback;
}

export function describeJoinError(error: unknown): string {
  if (error instanceof ApiError) {
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

export function directorySubtitle(entry: DirectoryEntry): string {
  const members = `${entry.memberCount} ${entry.memberCount === 1 ? 'member' : 'members'}`;
  return entry.kind === 'channel' ? `${members} · Channel` : members;
}

export function exploreActionTitle(entry: DirectoryEntry): string {
  return entry.joined ? 'Open' : 'Join';
}
