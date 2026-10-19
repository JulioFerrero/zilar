import { Effect } from 'effect';
import { changeTopic, type GroupActionStore } from '@zilar/client-core/store';

import type { ApproverRole, SetTopicRolesInput, TopicRole } from '../../lib/topics-api';
import type { GroupRole } from '@zilar/api-contract';
import type { ChatStoreState } from '../types';
import { lift, type StoreCtx } from './runtime';

export interface GroupRolesHelpers {
  readonly groupRolesById: Map<string, GroupRole[]>;
  readonly topicRolesById: Map<string, { roles: TopicRole[]; approverRole: ApproverRole | null }>;
  bumpRevision(): void;
  ensureGroupRoles(groupId: string, force?: boolean): Effect.Effect<void, unknown>;
  ensureTopicRoles(chatId: string, force?: boolean): Effect.Effect<void, unknown>;
  actionStore(): GroupActionStore;
}

/** Permissions are enforced by the server; these actions never decide them. */
export type GroupRolesActions = Pick<
  ChatStoreState,
  | 'groupRoles'
  | 'refreshGroupRoles'
  | 'createGroupRole'
  | 'renameGroupRole'
  | 'deleteGroupRole'
  | 'setGroupRoleMembers'
  | 'setTopicRoles'
  | 'topicRoles'
  | 'refreshTopicRoles'
>;

export function makeGroupRolesActions(
  ctx: StoreCtx,
  helpers: GroupRolesHelpers,
): GroupRolesActions {
  const { get, h } = ctx;
  const { topics, roles: rolesApi } = ctx.ports;
  const {
    groupRolesById,
    topicRolesById,
    bumpRevision,
    ensureGroupRoles,
    ensureTopicRoles,
    actionStore,
  } = helpers;

  return {
    groupRoles: (groupId) => {
      // Reading the revision subscribes the selector to role loads, like `groupDetail`.
      void get().groupDetailsRevision;
      return groupRolesById.get(groupId);
    },
    refreshGroupRoles: (groupId) => ctx.run(ensureGroupRoles(groupId, true)),
    createGroupRole: (groupId, name) =>
      ctx.run(
        Effect.gen(function* () {
          const role = yield* lift(() => rolesApi.createGroupRole(groupId, name));
          groupRolesById.set(groupId, [...(groupRolesById.get(groupId) ?? []), role]);
          bumpRevision();
          return role;
        }),
      ),
    renameGroupRole: (groupId, roleId, name) =>
      ctx.run(
        Effect.gen(function* () {
          const role = yield* lift(() => rolesApi.renameGroupRole(groupId, roleId, name));
          groupRolesById.set(
            groupId,
            (groupRolesById.get(groupId) ?? []).map((entry) =>
              entry.id === roleId ? role : entry,
            ),
          );
          bumpRevision();
          return role;
        }),
      ),
    deleteGroupRole: (groupId, roleId) =>
      ctx.run(
        Effect.gen(function* () {
          yield* lift(() => rolesApi.deleteGroupRole(groupId, roleId));
          groupRolesById.set(
            groupId,
            (groupRolesById.get(groupId) ?? []).filter((entry) => entry.id !== roleId),
          );
          bumpRevision();
        }),
      ),
    setGroupRoleMembers: (groupId, roleId, userIds) =>
      ctx.run(
        Effect.gen(function* () {
          const role = yield* lift(() => rolesApi.setGroupRoleMembers(groupId, roleId, userIds));
          const known = groupRolesById.get(groupId);
          groupRolesById.set(
            groupId,
            known === undefined
              ? [role]
              : known.some((entry) => entry.id === roleId)
                ? known.map((entry) => (entry.id === roleId ? role : entry))
                : [...known, role],
          );
          bumpRevision();
          return role;
        }),
      ),
    setTopicRoles: (chatId, input) =>
      ctx.run(
        changeTopic(
          ctx.coreCtx,
          actionStore(),
          chatId,
          (topicId) => topics.setTopicRoles(topicId, input as SetTopicRolesInput),
          // The refreshed row is server truth: a public flip cleared the roles there.
          (topic) => h.rememberTopicRoles(topic),
        ),
      ),
    topicRoles: (chatId) => {
      void get().groupDetailsRevision;
      const topicId = get().chats.find((entry) => entry.id === chatId)?.topic?.id;
      if (topicId === undefined) {
        return undefined;
      }
      return topicRolesById.get(topicId);
    },
    refreshTopicRoles: (chatId) => ctx.run(ensureTopicRoles(chatId, true)),
  };
}
