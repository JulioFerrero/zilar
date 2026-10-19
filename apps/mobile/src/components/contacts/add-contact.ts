import { ApiError } from '@zilar/api-contract';
import { Effect, type Effect as EffectType } from 'effect';
import { contactChatId, type ContactsApi, type HandleProfile } from '../../lib/contacts-api';

/**
 * The add-contact states, mirroring the web `AddContactDialog`: UI-free so the
 * screen tests can import them without pulling in `react-native`.
 */
export type AddContactState =
  | { state: 'idle' }
  | { state: 'found'; sent: boolean }
  | { state: 'missing' }
  | { state: 'error'; message: string };

export function addContactLookupFailure(error: unknown): AddContactState {
  if (error instanceof ApiError) {
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

export function addContactSendFailure(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'already_contact':
        return 'You are already contacts.';
      case 'request_exists':
        return 'A request is already pending.';
      case 'blocked':
        return 'Unblock this person first.';
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

export const NO_USER_MESSAGE = 'No user with that username';

/**
 * Runs a request action and re-fetches the profile inline in the same chain: the
 * refresh must not go through the busy-guarded runner, which would drop it while
 * the action holds the guard; a rejection reaches the caller unchanged.
 */
export const actOnProfileRequestEffect = Effect.fnUntraced(function* (
  api: ContactsApi,
  target: { userId: string; handle: string },
  work: (id: string) => Promise<unknown>,
  onProfile: (profile: HandleProfile) => void,
  onSentNone: () => void,
): EffectType.fn.Return<void, unknown> {
  const list = yield* Effect.tryPromise({
    try: () => api.listContactRequests(),
    catch: (cause) => cause,
  });
  const row = [...list.incoming, ...list.outgoing].find(
    (entry) => entry.other.userId === target.userId,
  );
  if (row !== undefined) {
    yield* Effect.tryPromise({ try: () => work(row.id), catch: (cause) => cause });
  }
  const found = yield* Effect.tryPromise({
    try: () => api.lookupByHandle(target.handle),
    catch: (cause) => cause,
  });
  onProfile(found);
  onSentNone();
});

export function actOnProfileRequest(
  api: ContactsApi,
  target: { userId: string; handle: string },
  work: (id: string) => Promise<unknown>,
  onProfile: (profile: HandleProfile) => void,
  onSentNone: () => void,
): Promise<void> {
  return Effect.runPromise(actOnProfileRequestEffect(api, target, work, onProfile, onSentNone));
}

/**
 * Resolves a contact's DM chat id without a refetch: the loaded chats first,
 * else the JID built from the user id and the viewer's domain — only when that
 * chat is also loaded, since a guessed id would open "Chat not found".
 */
export function resolveContactChat(
  chats: { id: string; kind: string }[],
  contactUserId: string,
  domain: string | undefined,
): string | undefined {
  if (domain === undefined) {
    return undefined;
  }
  const chatId = contactChatId(contactUserId, domain);
  return chats.some((chat) => chat.id === chatId) ? chatId : undefined;
}
