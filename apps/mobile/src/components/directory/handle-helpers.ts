import { DirectoryApiError, type DirectoryEntry } from '@/lib/directory-api';
import { describeDirectoryError } from './explore-helpers';

/**
 * Pure view mapping for the `@handle` share entry, kept separate from the route
 * so Node tests cover it without `expo-router`. A public group renders the card;
 * an unknown handle and a private group answer the same 404, so both read the
 * same neutral not-found line; anything else errors with Retry.
 */

export type HandleView =
  | { state: 'checking' }
  | { state: 'ready'; entry: DirectoryEntry }
  | { state: 'not-found' }
  | { state: 'error'; message: string };

export function handleRouteViewFor(error: unknown): HandleView {
  if (error instanceof DirectoryApiError && error.status === 404) {
    return { state: 'not-found' };
  }
  return {
    state: 'error',
    message: describeDirectoryError(error, 'Could not open that link. Try again.'),
  };
}

export function handleJoinLabel(entry: DirectoryEntry): string {
  if (entry.joined) {
    return 'Open';
  }
  return entry.kind === 'channel' ? 'Join the channel' : 'Join the group';
}

export type PostJoinTarget =
  { pathname: '/group/[id]'; params: { id: string } } | { pathname: '/' };

/**
 * Where to land after a public join: the group screen for the id from the join
 * result (or the directory entry), never a synchronous read of the chat list —
 * its refresh has not landed yet when the join resolves. Only a missing id
 * falls back to the list.
 */
export function postJoinTarget(groupId: string | undefined): PostJoinTarget {
  if (groupId === undefined || groupId === '') {
    return { pathname: '/' };
  }
  return { pathname: '/group/[id]', params: { id: groupId } };
}
