import { ContactsApiError, normalizeHandleInput } from '../../lib/contacts-api';

/**
 * The add-contact states (T-0182, mirrors the web `AddContactDialog` found /
 * missing / error branches): UI-free so the screen tests can import them
 * without pulling in `react-native`.
 */
export type AddContactState =
  | { state: 'idle' }
  | { state: 'found'; sent: boolean }
  | { state: 'missing' }
  | { state: 'error'; message: string };

export function addContactInitial(): AddContactState {
  return { state: 'idle' };
}

/** The typed handle, or null when the field is still empty. */
export function addContactHandle(raw: string): string | null {
  const normalized = normalizeHandleInput(raw);
  return normalized === '' ? null : normalized;
}

/** Reduces a lookup failure to the next view state. */
export function addContactLookupFailure(error: unknown): AddContactState {
  if (error instanceof ContactsApiError) {
    if (error.status === 404) {
      return { state: 'missing' };
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      return { state: 'error', message: 'Too many lookups — wait a little and try again.' };
    }
    if (error.status === 0 || error.code === 'network_error') {
      return { state: 'error', message: 'Could not reach the server. Try again.' };
    }
    return { state: 'error', message: 'Could not look up that username. Try again.' };
  }
  return { state: 'error', message: 'Could not look up that username. Try again.' };
}

/** Reduces a send failure to its inline message. */
export function addContactSendFailure(error: unknown): string {
  if (error instanceof ContactsApiError) {
    switch (error.code) {
      case 'already_contact':
        return 'You are already contacts.';
      case 'request_exists':
        return 'A request is already pending.';
      case 'too_many_requests':
        return 'Too many pending requests — wait for some answers first.';
      case 'declined_recently':
        return 'They declined recently — try again in a few days.';
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not send the request. Try again.';
}

/** The single plain "no user" line for an unknown handle. */
export const NO_USER_MESSAGE = 'No user with that username';
