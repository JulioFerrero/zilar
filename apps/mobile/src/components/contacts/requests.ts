import { Effect } from 'effect';
import { ContactsApiError, type ContactsApi } from '@/lib/contacts-api';

/**
 * The requests-screen states (T-0182, mirrors the web `RequestsPage`):
 * UI-free so the screen tests can import them without pulling in
 * `react-native`.
 */

export type RequestAction = 'accept' | 'decline' | 'cancel';

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

/**
 * Runs one request action (Accept, Decline, Cancel) and removes the row on
 * success. Resolves with null on success, or the inline failure message —
 * the row stays on failure so the user can retry. UI-free so the screen
 * tests can drive it with a fake API.
 */
const sendAction = (api: ContactsApi, id: string, action: RequestAction): Promise<unknown> => {
  if (action === 'accept') {
    return api.acceptContactRequest(id);
  }
  if (action === 'decline') {
    return api.declineContactRequest(id);
  }
  return api.cancelContactRequest(id);
};

export const performRequestActionEffect = (
  api: ContactsApi,
  id: string,
  action: RequestAction,
  remove: (id: string) => void,
): Effect.Effect<string | null> =>
  Effect.tryPromise({ try: () => sendAction(api, id, action), catch: (cause) => cause }).pipe(
    Effect.andThen(() => Effect.try({ try: () => remove(id), catch: (cause) => cause })),
    Effect.map((): string | null => null),
    Effect.catch((error: unknown) => Effect.succeed(requestsActionFailure(error))),
  );

export function performRequestAction(
  api: ContactsApi,
  id: string,
  action: RequestAction,
  remove: (id: string) => void,
): Promise<string | null> {
  return Effect.runPromise(performRequestActionEffect(api, id, action, remove));
}
