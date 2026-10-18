import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

export interface GroupMembershipHelpers {
  readonly ensureGroupDetail: (
    groupId: string,
    force?: boolean,
  ) => Effect.Effect<void, never, Ports>;
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
}

/** Permissions are enforced by the server; these actions never decide them. */
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
