import { Effect, type Effect as EffectType } from 'effect';
import { ContactsApiError, type ContactsApi } from '../../lib/contacts-api';

/**
 * The contacts page's remove flow, mirroring the web `ContactsPage`: every error
 * is a fixed sentence, never the server's raw message.
 */

const RATE_LIMIT_MESSAGE = 'Too many tries — wait a little and try again.';

function rateLimited(error: unknown): boolean {
  return (
    error instanceof ContactsApiError && (error.status === 429 || error.code === 'rate_limited')
  );
}

export function contactsLoadFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not load contacts. Try again.';
}

export function removeContactFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  if (error instanceof ContactsApiError && error.status === 404) {
    return 'That person is no longer a contact.';
  }
  return 'Could not remove contact. Try again.';
}

const removeSteps = Effect.fnUntraced(function* (
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): EffectType.fn.Return<void, unknown> {
  yield* Effect.tryPromise({ try: () => api.removeContact(userId), catch: (cause) => cause });
  yield* Effect.try({ try: onRemoved, catch: (cause) => cause });
});

export const performRemoveContactEffect = (
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): Effect.Effect<string | null> =>
  removeSteps(api, userId, onRemoved).pipe(
    Effect.map((): string | null => null),
    Effect.catch((error: unknown) => Effect.succeed(removeContactFailure(error))),
  );

export function performRemoveContact(
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): Promise<string | null> {
  return Effect.runPromise(performRemoveContactEffect(api, userId, onRemoved));
}
