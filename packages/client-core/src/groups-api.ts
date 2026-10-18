// effect-plain: Promise port over the contract; each app's `call` owns the
// Effect edge (T-2056).
// The shared groups calls: web and phone each supply a `call` that runs one
// contract request over their own transport, so endpoints live once.
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
 * The groups API of both apps, over the caller's `call`: one group's detail,
 * its AIs, custom roles, members, invite links and joins. The web-only calls
 * (create, settings, background, directory, public join) stay in the apps.
 */
export function makeGroupsApi(call: GroupsCall) {
  return {
    getGroup: (groupId: string): Promise<GroupDetail> =>
      call((client) => client.groups.detail({ params: { id: groupId } })),

    // T-0054: an owner or admin adds their own AI to a group, and its owner or a
    // group manager removes it. Both answer the fresh group detail.
    addGroupAi: (groupId: string, aiId: string): Promise<GroupDetail> =>
      call((client) => client.groups.addAi({ params: { id: groupId }, payload: { aiId } })),
    removeGroupAi: (groupId: string, aiId: string): Promise<GroupDetail> =>
      call((client) => client.groups.removeAi({ params: { id: groupId, aiId } })),

    // --- Group roles (T-0116) -------------------------------------------------
    // Custom group roles: labels with two powers (private-topic access and
    // approver rights). Reading needs only membership; every write needs a
    // group owner/admin.
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

    // --- Channels (T-0124) -----------------------------------------------------
    // One-way broadcast feeds: only owner/admins post (the room is moderated and
    // subscribers are visitors), everyone else subscribes, reads and mutes. A
    // channel is a group with one feed (its General topic): no more topics, and
    // the member list is visible to admins only (subscribers see the count).
    listGroupMembers: (groupId: string): Promise<GroupMember[]> =>
      call((client) => client.groups.members({ params: { id: groupId } })).then(
        ({ members }) => members,
      ),

    // Only the owner may promote a member to admin (or demote one back). The
    // room affiliation follows at once, so a channel's voice mapping is enforced
    // by the room. Demoting the last admin answers 409 `channel_needs_admin`.
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

    // T-1190: the owner hands the group to another member (the target becomes
    // owner, the actor an admin). The server answers the fresh group detail.
    transferGroupOwner: (groupId: string, userId: string): Promise<GroupDetail> =>
      call((client) =>
        client.groups.transferOwner({ params: { id: groupId }, payload: { userId } }),
      ),

    // T-1243: the owner deletes the group for everyone. Every topic room is
    // destroyed and the group's rows cascade; the server answers 204 with no body.
    deleteGroup: (groupId: string): Promise<void> =>
      call((client) => client.groups.deleteGroup({ params: { id: groupId } })).then(
        () => undefined,
      ),

    // T-1183: owners and admins add contacts to a group. The server answers the
    // fresh group detail.
    addGroupMembers: (groupId: string, userIds: string[]): Promise<GroupDetail> =>
      call((client) => client.groups.addMembers({ params: { id: groupId }, payload: { userIds } })),

    // --- Group invite links (T-0115) -------------------------------------------
    // Shareable links that join a group as `member` (`${WEB}/j/<token>` on the
    // web). The token is shown once at creation and never stored — the list
    // below carries hints, labels, uses and state, never tokens.
    // The server trims `label`; the contract encodes the trimmed form, so the
    // client trims before sending.
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

    // --- Join by link (T-0115) -------------------------------------------------
    // The preview names the group and counts its members — never member names,
    // and never the group id unless the caller is already a member (they know
    // it; the join page opens the group chat with it). Joining adds the caller
    // as `member` and returns the group id; an existing member answers
    // `alreadyMember: true` without consuming a use.
    previewJoinLink: (token: string): Promise<JoinPreview> =>
      call((client) => client['invite-links'].preview({ params: { token } })),
    // T-0124: `channel` previews read "Join channel" (and count subscribers);
    // `kind` is absent on older servers = a group.
    joinByLink: (token: string): Promise<JoinResult> =>
      call((client) => client['invite-links'].join({ params: { token } })),
  };
}
