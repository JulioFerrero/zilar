import { omitUndefined, type PatchGroupPayload } from '@zilar/api-contract';
import { makeGroupsApi as makeSharedGroupsApi } from '@zilar/client-core';

import type { GroupMember } from './chat-api';
import type { ApiCall } from './effect/api-client';

/**
 * A malformed payload throws `invalid_response`; raw server messages never reach the UI.
 */

export type ChannelMemberRole = 'admin' | 'member';

export interface GroupsApi {
  createChannel(input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
  createGroup(input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
  /**
   * The full audience for owners/admins, the owner/admins slice for channel subscribers (never the audience), 404 for strangers.
   */
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  /**
   * Owner only: a non-owner sees the same 404 as an unknown id, and the last-admin demotion answers 409 `channel_needs_admin`.
   */
  changeGroupMemberRole(groupId: string, userId: string, role: ChannelMemberRole): Promise<void>;
  /**
   * Owners/admins, or the caller themself to leave; removing the last admin answers 409 `channel_needs_admin`.
   */
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  /**
   * Owners/admins only; the fresh detail is dropped because the store reloads it.
   */
  addGroupMembers(groupId: string, userIds: string[]): Promise<void>;
  /**
   * Owners/admins only.
   */
  addGroupAi(groupId: string, aiId: string): Promise<void>;
  /**
   * Its owner or a manager.
   */
  removeGroupAi(groupId: string, aiId: string): Promise<void>;
  /**
   * Only the owner; the target becomes owner and the caller an admin.
   */
  transferGroupOwner(groupId: string, userId: string): Promise<void>;
  /**
   * Only the owner; every topic room is destroyed.
   */
  deleteGroup(groupId: string): Promise<void>;
  /**
   * Callers send only the keys they set; the payload drops the undefined ones, so an untouched field is never cleared.
   */
  patchGroupSettings(groupId: string, patch: PatchGroupPayload): Promise<void>;
}

export function makeGroupsApi(call: ApiCall): GroupsApi {
  const api = makeSharedGroupsApi(call);
  return {
    createChannel: (input) =>
      call((client) =>
        client.groups.create({
          payload: {
            title: input.title.trim(),
            kind: 'channel',
            ...(input.description === undefined || input.description.trim() === ''
              ? {}
              : { description: input.description.trim() }),
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public' as const, handle: input.handle }
              : {}),
          },
        }),
      ).then(({ id }) => ({ id })),
    createGroup: (input) =>
      call((client) =>
        client.groups.create({
          payload: {
            title: input.title.trim(),
            memberIds: input.memberIds,
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public' as const, handle: input.handle }
              : {}),
          },
        }),
      ).then(({ id }) => ({ id })),
    listGroupMembers: (groupId) =>
      api.listGroupMembers(groupId).then((members) =>
        members.map((member) => ({
          userId: member.userId,
          name: member.name,
          role: member.role,
          roles: member.roles ?? [],
        })),
      ),
    changeGroupMemberRole: (groupId, userId, role) =>
      api.changeGroupMemberRole(groupId, userId, role).then(() => undefined),
    removeGroupMember: (groupId, userId) =>
      api.removeGroupMember(groupId, userId).then(() => undefined),
    // The fresh detail is dropped; the store reloads it, so the cache is one source.
    addGroupMembers: (groupId, userIds) =>
      api.addGroupMembers(groupId, userIds).then(() => undefined),
    addGroupAi: (groupId, aiId) => api.addGroupAi(groupId, aiId).then(() => undefined),
    removeGroupAi: (groupId, aiId) => api.removeGroupAi(groupId, aiId).then(() => undefined),
    // The fresh detail is dropped; the store reloads it, so the cache is one source.
    transferGroupOwner: (groupId, userId) =>
      api.transferGroupOwner(groupId, userId).then(() => undefined),
    deleteGroup: (groupId) => api.deleteGroup(groupId),
    // `omitUndefined` sends only the keys the caller set, so a patch of one setting never clears another.
    patchGroupSettings: async (groupId, patch) => {
      await call((client) =>
        client.groups.patch({ params: { id: groupId }, payload: omitUndefined(patch) }),
      );
    },
  };
}
