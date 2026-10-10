import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { GroupInviteLink, GroupRole } from '@/lib/api';
import { listGroupInviteLinks, listGroupRoles } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, type ActionState } from '@/lib/effect/use-action';
import { describeAiError } from '../ais/errors';

/** A failed panel action; `message` is the sentence the panel shows. */
export class PanelFailure extends Data.TaggedError('PanelFailure')<{ readonly message: string }> {}

/**
 * The sentence for a failed API call: the server's message, or the fallback
 * when the call never reached the server (`toApiFailure` marks that case).
 */
function apiFailureText(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

/** An API call whose failure shows `fallback` unless the server sent a message. */
export function apiStep<A>(
  call: () => Promise<A>,
  fallback: string,
): Effect.Effect<A, PanelFailure> {
  return fromApi(call).pipe(
    Effect.mapError((failure) => new PanelFailure({ message: apiFailureText(failure, fallback) })),
  );
}

/**
 * A store call. The store throws the raw error, so `textOf` builds the
 * sentence from that error (the text the panel showed before the move).
 */
export function storeStep<A>(
  call: () => Promise<A>,
  textOf: (error: unknown) => string,
): Effect.Effect<A, PanelFailure> {
  return Effect.tryPromise({
    try: call,
    catch: (error) => new PanelFailure({ message: textOf(error) }),
  });
}

export function settingText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not save the setting.';
}

export function addAiText(error: unknown): string {
  return describeAiError(error, 'Could not add the AI').message;
}

export function removeAiText(error: unknown): string {
  return describeAiError(error, 'Could not remove the AI').message;
}

/** The shown failure of the last call; hidden while a new call runs. */
export function messageOf<A>(state: ActionState<A, PanelFailure>): string | undefined {
  return isWaiting(state) ? undefined : failureOf(state)?.message;
}

/** The invite links, for managers only; a plain member makes no request. */
export function loadLinks(
  manager: boolean,
  groupId: string | undefined,
): Effect.Effect<GroupInviteLink[], PanelFailure> {
  if (!manager || groupId === undefined) {
    return Effect.succeed([]);
  }
  return fromApi(() => listGroupInviteLinks(groupId)).pipe(
    Effect.mapError(() => new PanelFailure({ message: 'Could not load the invite links.' })),
  );
}

/** The group's roles. With no group yet the load waits, so the section reads as loading. */
export function loadRoles(groupId: string | undefined): Effect.Effect<GroupRole[], PanelFailure> {
  if (groupId === undefined) {
    return Effect.never;
  }
  return apiStep(() => listGroupRoles(groupId), 'Could not load the roles.');
}

export type RolesView = {
  status: 'loading' | 'ready' | 'error';
  roles: GroupRole[];
  message: string;
};

export function rolesViewOf(result: AsyncResult.AsyncResult<GroupRole[], PanelFailure>): RolesView {
  if (isWaiting(result) || AsyncResult.isInitial(result)) {
    return { status: 'loading', roles: [], message: '' };
  }
  if (AsyncResult.isSuccess(result)) {
    return { status: 'ready', roles: result.value, message: '' };
  }
  return { status: 'error', roles: [], message: failureOf(result)?.message ?? '' };
}
