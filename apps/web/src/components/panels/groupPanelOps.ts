import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { GroupInviteLink, GroupRole } from '@/lib/api';
import { listGroupInviteLinks, listGroupRoles } from '@/lib/api';
import { fromApi, type ApiFailure, failureOf, isWaiting } from '@zilar/client-core';
import { describeAiError } from '../ais/errors';
import type { ActionState } from '@zilar/client-core';

export class PanelFailure extends Data.TaggedError('PanelFailure')<{ readonly message: string }> {}

export function apiFailureText(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

export function apiStep<A>(
  call: () => Promise<A>,
  fallback: string,
): Effect.Effect<A, PanelFailure> {
  return fromApi(call).pipe(
    Effect.mapError((failure) => new PanelFailure({ message: apiFailureText(failure, fallback) })),
  );
}

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

export function messageOf<A>(state: ActionState<A, PanelFailure>): string | undefined {
  return isWaiting(state) ? undefined : failureOf(state)?.message;
}

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
