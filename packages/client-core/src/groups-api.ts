// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import type { Effect } from 'effect';
import {
  omitUndefined,
  type CreatedInviteLink,
  type GroupDetail,
  type GroupMember,
  type GroupRole,
  type InviteLink,
  type JoinPreview,
  type JoinResult,
  type ZilarClient,
} from '@zilar/api-contract';

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

type GroupsCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

/**
 * The groups API shared by both apps, over the caller's `call`; the web-only calls
 * (create, settings, background, directory, public join) stay in the apps.
 */
export function makeGroupsApi(call: GroupsCall) {
  return {
    getGroup: (groupId: string): Promise<GroupDetail> =>
      call((client) => client.groups.detail({ params: { id: groupId } })),

    // An owner or admin adds their own AI; the group's owner or a manager removes it.
    addGroupAi: (groupId: string, aiId: string): Promise<GroupDetail> =>
      call((client) => client.groups.addAi({ params: { id: groupId }, payload: { aiId } })),
    removeGroupAi: (groupId: string, aiId: string): Promise<GroupDetail> =>
      call((client) => client.groups.removeAi({ params: { id: groupId, aiId } })),

    // Custom group roles: labels with private-topic access and approver rights. Reading
    // needs membership; every write needs a group owner/admin.
    listGroupRoles: (groupId: string): Promise<GroupRole[]> =>
      call((client) => client.roles.list({ params: { id: groupId } })).then(({ roles }) => roles),

    // The server trims `name`; the contract encodes the trimmed form, so the
    // client trims before sending.
    createGroupRole: (groupId: string, name: string): Promise<GroupRole> =>
      call((client) =>
        client.roles.create({ params: { id: groupId }, payload: { name: name.trim() } }),
      ),
    renameGroupRole: (groupId: string, roleId: string, name: string): Promise<GroupRole> =>
      call((client) =>
        client.roles.rename({ params: { id: groupId, roleId }, payload: { name: name.trim() } }),
      ),
    deleteGroupRole: (groupId: string, roleId: string): Promise<void> =>
      call((client) => client.roles.remove({ params: { id: groupId, roleId } })).then(
        () => undefined,
      ),
    setGroupRoleMembers: (groupId: string, roleId: string, userIds: string[]): Promise<GroupRole> =>
      call((client) =>
        client.roles.setMembers({ params: { id: groupId, roleId }, payload: { userIds } }),
      ),

    // Channels are one-way: only owner/admins post, everyone else subscribes and reads.
    // One feed (General) only; subscribers see the member count, admins the list.
    listGroupMembers: (groupId: string): Promise<GroupMember[]> =>
      call((client) => client.groups.members({ params: { id: groupId } })).then(
        ({ members }) => members,
      ),

    // Only the owner promotes or demotes an admin; demoting the last admin answers 409
    // `channel_needs_admin`.
    changeGroupMemberRole: (
      groupId: string,
      userId: string,
      role: 'admin' | 'member',
    ): Promise<GroupDetail> =>
      call((client) =>
        client.groups.changeRole({ params: { id: groupId, userId }, payload: { role } }),
      ),
    removeGroupMember: (groupId: string, userId: string): Promise<GroupDetail> =>
      call((client) => client.groups.removeMember({ params: { id: groupId, userId } })),

    // The owner hands the group to another member (the target becomes owner, the actor
    // an admin).
    transferGroupOwner: (groupId: string, userId: string): Promise<GroupDetail> =>
      call((client) =>
        client.groups.transferOwner({ params: { id: groupId }, payload: { userId } }),
      ),

    // Deleting a group destroys every topic room; the rows cascade.
    deleteGroup: (groupId: string): Promise<void> =>
      call((client) => client.groups.deleteGroup({ params: { id: groupId } })).then(
        () => undefined,
      ),

    // Owners and admins add contacts to a group.
    addGroupMembers: (groupId: string, userIds: string[]): Promise<GroupDetail> =>
      call((client) => client.groups.addMembers({ params: { id: groupId }, payload: { userIds } })),

    // Invite links join as `member`; the token is shown once and never stored, so the list
    // carries hints, labels, uses and state, never tokens. The server trims `label` too,
    // so the client trims before sending.
    createGroupInviteLink: (
      groupId: string,
      input: CreateGroupInviteLinkInput = {},
    ): Promise<CreatedInviteLink> =>
      call((client) =>
        client['invite-links'].createLink({
          params: { id: groupId },
          payload: {
            ...omitUndefined(input),
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
          },
        }),
      ),
    listGroupInviteLinks: (groupId: string): Promise<InviteLink[]> =>
      call((client) => client['invite-links'].listLinks({ params: { id: groupId } })).then(
        ({ links }) => links,
      ),
    revokeGroupInviteLink: (groupId: string, linkId: string): Promise<void> =>
      call((client) => client['invite-links'].revokeLink({ params: { id: groupId, linkId } })).then(
        () => undefined,
      ),

    // The preview names the group and counts members, never names, and never the group id
    // unless the caller is already a member. Joining adds the caller as `member`; an
    // existing member answers `alreadyMember: true` without consuming a use.
    previewJoinLink: (token: string): Promise<JoinPreview> =>
      call((client) => client['invite-links'].preview({ params: { token } })),
    // A `channel` preview reads "Join channel" (and counts subscribers); `kind` is absent
    // on older servers, which means a group.
    joinByLink: (token: string): Promise<JoinResult> =>
      call((client) => client['invite-links'].join({ params: { token } })),
  };
}
