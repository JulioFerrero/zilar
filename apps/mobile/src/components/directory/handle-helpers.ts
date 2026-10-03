import { DirectoryApiError, type DirectoryEntry } from '@/lib/directory-api';
import { describeDirectoryError } from './explore-helpers';

/**
 * Pure view mapping for the `@handle` share entry (T-0183): kept separate
 * from the route so Node tests cover it without `expo-router` (no
 * simulator, no new dependency). A public group renders the card; an
 * unknown handle and a private group answer the same 404, so both read the
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

/** "Open" for a group already joined, else Join (channels named). */
export function handleJoinLabel(entry: DirectoryEntry): string {
  if (entry.joined) {
    return 'Open';
  }
  return entry.kind === 'channel' ? 'Join the channel' : 'Join the group';
}
