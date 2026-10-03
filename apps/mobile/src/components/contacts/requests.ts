import { ContactsApiError } from '@/lib/contacts-api';

/**
 * The requests-screen states (T-0182, mirrors the web `RequestsPage`):
 * UI-free so the screen tests can import them without pulling in
 * `react-native`.
 */
export type RequestsState = 'loading' | 'ready' | 'error';

export function requestsLoadFailure(error: unknown): string {
  if (error instanceof ContactsApiError) {
    if (error.status === 429 || error.code === 'rate_limited') {
      return 'Too many tries — wait a little and try again.';
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

/** The action failure for an accept / decline / cancel press. */
export function requestsActionFailure(error: unknown): string {
  if (error instanceof ContactsApiError && error.status === 404) {
    return 'That request is no longer here.';
  }
  return requestsLoadFailure(error);
}
