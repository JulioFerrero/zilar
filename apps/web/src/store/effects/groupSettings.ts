import { Effect } from 'effect';
import {
  changeGroup as changeGroupCore,
  joinPublicGroup as joinPublicGroupAction,
  leaveChannel as leaveChannelAction,
} from '@zilar/client-core/store';
import type { GroupBackground, GroupDetail, SetGroupListenerInput } from '@/lib/api';
import {
  addGroupMembers as addGroupMembersRequest,
  transferGroupOwner as transferGroupOwnerRequest,
} from '@/lib/api/groups';
import type { StoreCtx } from './ctx';
import { groupChangeStore, groupIdOf } from './groupShared';
import { refreshChatsOrThrow } from './history';
import { Ports } from './ports';
import { fromPromise } from './util';

const GROUP_NOT_AVAILABLE = 'This group is not available yet.';

type GroupWrite = Effect.Effect<void, unknown, Ports>;

// One group route: apply the returned detail, then repaint the list when asked.
const changeGroup = (
  ctx: StoreCtx,
  chatId: string,
  call: (groupId: string) => Promise<GroupDetail>,
  refresh: boolean,
): GroupWrite =>
  changeGroupCore<GroupDetail, Ports>(
    groupChangeStore(ctx, groupIdOf(ctx, chatId)),
    chatId,
    GROUP_NOT_AVAILABLE,
    call,
    refresh,
  );

// Leaving a channel removes the caller's membership through the route admins also use.
export const leaveChannel = (ctx: StoreCtx, chatId: string): GroupWrite =>
  leaveChannelAction(
    {
      groupIdFor: (chatId) => ctx.groupIds.get(chatId),
      currentUserId: () => ctx.get().me?.id,
      removeMember: (groupId, userId) =>
        fromPromise(() => ctx.ports.api.removeGroupMember(groupId, userId)),
    },
    refreshChatsOrThrow(ctx),
    chatId,
  );

// Owners and admins add contacts; the detail and list refresh so counts match.
export const addGroupMembers = (ctx: StoreCtx, chatId: string, userIds: string[]): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => addGroupMembersRequest(groupId, userIds), true);

// Owners and admins remove another member (removing yourself is leaveChannel).
export const removeGroupMember = (ctx: StoreCtx, chatId: string, userId: string): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => ctx.ports.api.removeGroupMember(groupId, userId), true);

// The owner hands the group over; the detail and list refresh so myRole matches.
export const transferGroupOwner = (ctx: StoreCtx, chatId: string, userId: string): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => transferGroupOwnerRequest(groupId, userId), true);

// Promote/demote through the role route (owner only); the detail and list refresh, so the
// acting device matches server truth. The target converges on the next list refresh.
export const changeChannelRole = (
  ctx: StoreCtx,
  chatId: string,
  userId: string,
  role: 'admin' | 'member',
): GroupWrite =>
  changeGroup(
    ctx,
    chatId,
    (groupId) => ctx.ports.api.changeGroupMemberRole(groupId, userId, role),
    true,
  );

export const setMembersCanCreateTopics = (
  ctx: StoreCtx,
  chatId: string,
  allowed: boolean,
): GroupWrite =>
  changeGroup(
    ctx,
    chatId,
    (groupId) => ctx.ports.api.setMembersCanCreateTopics(groupId, allowed),
    false,
  );

// The detail refresh repaints every chat of the group at once.
export const setGroupBackground = (
  ctx: StoreCtx,
  chatId: string,
  background: GroupBackground,
): GroupWrite =>
  changeGroup(
    ctx,
    chatId,
    (groupId) => ctx.ports.api.setGroupBackground(groupId, background),
    false,
  );

// The detail refresh repaints the panel.
export const setGroupListener = (
  ctx: StoreCtx,
  chatId: string,
  input: SetGroupListenerInput,
): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => ctx.ports.api.setGroupListener(groupId, input), false);

// The detail refreshes from server truth, so the panel, label and share link update at once.
export const setGroupVisibility = (
  ctx: StoreCtx,
  chatId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => ctx.ports.api.setGroupVisibility(groupId, input), true);

// Joins with one request, refreshes the list and resolves General from the painted rows,
// falling back to undefined when the list has not caught up.
export const joinPublicGroup = (
  ctx: StoreCtx,
  groupId: string,
): Effect.Effect<string | undefined, unknown, Ports> =>
  joinPublicGroupAction(
    ctx,
    {
      join: (id) => ctx.ports.api.joinPublicGroup(id),
      refreshList: () => refreshChatsOrThrow(ctx),
    },
    groupId,
  );

export const addGroupAi = (ctx: StoreCtx, chatId: string, aiId: string): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => ctx.ports.api.addGroupAi(groupId, aiId), false);

export const removeGroupAi = (ctx: StoreCtx, chatId: string, aiId: string): GroupWrite =>
  changeGroup(ctx, chatId, (groupId) => ctx.ports.api.removeGroupAi(groupId, aiId), false);
