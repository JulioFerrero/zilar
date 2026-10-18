import { ApiError } from '@zilar/api-contract';
import { Effect, type Effect as EffectType } from 'effect';
import { reloadBlockedJids } from '../../lib/blocked-users';
import type { ContactsApi } from '../../lib/contacts-api';

/**
 * The block / unblock states, mirroring the web `ContactProfileRow` and
 * `BlockedPage`: UI-free so the card and screen tests drive them with a fake
 * API. Every error is a fixed sentence, never the server's raw message.
 */

const RATE_LIMIT_MESSAGE = 'Too many tries — wait a little and try again.';

function rateLimited(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.code === 'rate_limited');
}

export function blockFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not block. Try again.';
}

export function unblockFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not unblock. Try again.';
}

export function blockedLoadFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not load blocked people. Try again.';
}

const blockSteps = Effect.fnUntraced(function* (
  api: ContactsApi,
  userId: string,
  onBlocked: () => void,
): EffectType.fn.Return<void, unknown> {
  yield* Effect.tryPromise({ try: () => api.blockUser(userId), catch: (cause) => cause });
  yield* Effect.tryPromise({ try: () => reloadBlockedJids(api), catch: (cause) => cause });
  yield* Effect.try({ try: onBlocked, catch: (cause) => cause });
});

const unblockSteps = Effect.fnUntraced(function* (
  api: ContactsApi,
  userId: string,
  onUnblocked: () => void,
): EffectType.fn.Return<void, unknown> {
  yield* Effect.tryPromise({ try: () => api.unblockUser(userId), catch: (cause) => cause });
  yield* Effect.tryPromise({ try: () => reloadBlockedJids(api), catch: (cause) => cause });
  yield* Effect.try({ try: onUnblocked, catch: (cause) => cause });
});

export const performBlockEffect = (
  api: ContactsApi,
  userId: string,
  onBlocked: () => void,
): Effect.Effect<string | null> =>
  blockSteps(api, userId, onBlocked).pipe(
    Effect.map((): string | null => null),
    Effect.catch((error: unknown) => Effect.succeed(blockFailure(error))),
  );

export const performUnblockEffect = (
  api: ContactsApi,
  userId: string,
  onUnblocked: () => void,
): Effect.Effect<string | null> =>
  unblockSteps(api, userId, onUnblocked).pipe(
    Effect.map((): string | null => null),
    Effect.catch((error: unknown) => Effect.succeed(unblockFailure(error))),
  );

export function performBlock(
  api: ContactsApi,
  userId: string,
  onBlocked: () => void,
): Promise<string | null> {
  return Effect.runPromise(performBlockEffect(api, userId, onBlocked));
}

export function performUnblock(
  api: ContactsApi,
  userId: string,
  onUnblocked: () => void,
): Promise<string | null> {
  return Effect.runPromise(performUnblockEffect(api, userId, onUnblocked));
}
