import { reloadBlockedJids } from '../../lib/blocked-users';
import { ContactsApiError, type ContactsApi } from '../../lib/contacts-api';

/**
 * The block / unblock states (T-0244, mirrors the web `ContactProfileRow`
 * and `BlockedPage`): UI-free so the card and screen tests can drive them
 * with a fake API. Every error is a fixed sentence, never the server's raw
 * message.
 */

const RATE_LIMIT_MESSAGE = 'Too many tries — wait a little and try again.';

function rateLimited(error: unknown): boolean {
  return (
    error instanceof ContactsApiError && (error.status === 429 || error.code === 'rate_limited')
  );
}

/** The inline failure for a block press. */
export function blockFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not block. Try again.';
}

/** The inline failure for an unblock press (card or blocked screen). */
export function unblockFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not unblock. Try again.';
}

/** The failure for loading the blocked list. */
export function blockedLoadFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not load blocked people. Try again.';
}

/**
 * Blocks the user and runs `onBlocked` on success. Resolves null on success,
 * or the inline failure message. The caller updates the shown relation.
 */
export async function performBlock(
  api: ContactsApi,
  userId: string,
  onBlocked: () => void,
): Promise<string | null> {
  try {
    await api.blockUser(userId);
    await reloadBlockedJids(api);
    onBlocked();
    return null;
  } catch (error: unknown) {
    return blockFailure(error);
  }
}

/**
 * Unblocks the user and runs `onUnblocked` on success (the card updates the
 * relation, the blocked screen removes the row). Resolves null on success,
 * or the inline failure message (nothing changes so the user can retry).
 */
export async function performUnblock(
  api: ContactsApi,
  userId: string,
  onUnblocked: () => void,
): Promise<string | null> {
  try {
    await api.unblockUser(userId);
    await reloadBlockedJids(api);
    onUnblocked();
    return null;
  } catch (error: unknown) {
    return unblockFailure(error);
  }
}
