import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

/** The closure helpers of `makeGroups` these actions read (T-1569). */
export interface GroupMembershipHelpers {
  /** Loads a group's detail once; `force` reloads it after a write. */
  readonly ensureGroupDetail: (
    groupId: string,
    force?: boolean,
  ) => Effect.Effect<void, never, Ports>;
  /** A best-effort chat-list refresh: its failure is dropped. */
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
}

/**
 * The membership writes of the group info pages (T-1569), located here because
 * `group-actions.ts` is at its file-size limit. Each write follows the
 * `transferGroupOwner` pattern: call the route, reload the group detail so the
 * page repaints with server truth, then refresh the chat list best-effort.
 * Permissions are enforced by the server; these actions never decide them.
 */
export type GroupMembershipActions = Pick<
  ChatStoreState,
  'addGroupMembers' | 'removeGroupMember' | 'addGroupAi' | 'removeGroupAi'
>;

export function makeGroupMembershipActions(
  ctx: StoreCtx,
  helpers: GroupMembershipHelpers,
): GroupMembershipActions {
  const { groups: groupsApi } = ctx.ports;
  const { ensureGroupDetail, refreshQuietly } = helpers;

  const writeAndReload = (write: () => Promise<void>, groupId: string): Promise<void> =>
    ctx.run(
      Effect.gen(function* () {
        yield* lift(write);
        yield* ensureGroupDetail(groupId, true);
        yield* refreshQuietly;
      }),
    );

  return {
    addGroupMembers: (groupId, userIds) =>
      writeAndReload(() => groupsApi.addGroupMembers(groupId, userIds), groupId),
    removeGroupMember: (groupId, userId) =>
      writeAndReload(() => groupsApi.removeGroupMember(groupId, userId), groupId),
    addGroupAi: (groupId, aiId) =>
      writeAndReload(() => groupsApi.addGroupAi(groupId, aiId), groupId),
    removeGroupAi: (groupId, aiId) =>
      writeAndReload(() => groupsApi.removeGroupAi(groupId, aiId), groupId),
  };
}
