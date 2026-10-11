// Group settings and membership: leaving a channel or a group, roles,
// visibility, the shared background, the AI listener and the group's own AIs.
import { Effect } from 'effect';
import {
  changeGroup as changeGroupCore,
  joinPublicGroup as joinPublicGroupAction,
  leaveChannel as leaveChannelAction,
} from '@zilar/client-core/store';
import type { GroupBackground, GroupDetail, SetGroupListenerInput } from '@/lib/api';
import type { StoreCtx } from './ctx';
import { groupChangeStore, groupIdOf } from './groupShared';
import { refreshChatsOrThrow } from './history';
import { Ports } from './ports';
import { fromPromise } from './util';

// T-0124: leaving a channel removes the caller's membership through the member
// route (the same route admins use to remove others). The list refreshes
// itself away; the caller navigates away.
export const leaveChannel = (ctx: StoreCtx, chatId: string): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* leaveChannelAction(
      {
        groupIdFor: (chatId) => ctx.groupIds.get(chatId),
        currentUserId: () => ctx.get().me?.id,
        removeMember: (groupId, userId) =>
          fromPromise(() => api.removeGroupMember(groupId, userId)),
      },
      refreshChatsOrThrow(ctx),
      chatId,
    );
  });

// T-0124: promote/demote through the role route (owner only). The detail
// refreshes, so the panel updates at once; the chat list refreshes too, so the
// acting device's rows (myRole, counts) match server truth and the composer
// bar flips. The target's own device converges on the next list refresh (60s
// poll / focus), like every other membership change in the app.
export const changeChannelRole = (
  ctx: StoreCtx,
  chatId: string,
  userId: string,
  role: 'admin' | 'member',
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, ctx.groupIds.get(chatId)),
      chatId,
      'This channel is not available yet.',
      (groupId) => api.changeGroupMemberRole(groupId, userId, role),
      true,
    );
  });

export const setMembersCanCreateTopics = (
  ctx: StoreCtx,
  chatId: string,
  allowed: boolean,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, groupIdOf(ctx, chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.setMembersCanCreateTopics(groupId, allowed),
      false,
    );
  });

// T-0466: owners/admins set the group's shared background; the detail refresh
// repaints every chat of the group at once.
export const setGroupBackground = (
  ctx: StoreCtx,
  chatId: string,
  background: GroupBackground,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, groupIdOf(ctx, chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.setGroupBackground(groupId, background),
      false,
    );
  });

// T-0478: owners/admins turn the group's AI listener on/off or set its
// eagerness; the detail refresh repaints the panel.
export const setGroupListener = (
  ctx: StoreCtx,
  chatId: string,
  input: SetGroupListenerInput,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, groupIdOf(ctx, chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.setGroupListener(groupId, input),
      false,
    );
  });

// T-0164: the owner flips a group public (with a handle) or back to private.
// The detail refreshes from server truth (like the role change), so the panel,
// the label and the share link update at once.
export const setGroupVisibility = (
  ctx: StoreCtx,
  chatId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, groupIdOf(ctx, chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.setGroupVisibility(groupId, input),
      true,
    );
  });

// T-0164: joins a public group with one request, then opens it: the list
// refreshes (the new membership arrives) and the General chat id resolves from
// the painted rows, falling back to undefined when the list has not caught up
// yet (the caller navigates home instead).
export const joinPublicGroup = (
  ctx: StoreCtx,
  groupId: string,
): Effect.Effect<string | undefined, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* joinPublicGroupAction(
      ctx,
      {
        join: (id) => api.joinPublicGroup(id),
        refreshList: () => refreshChatsOrThrow(ctx),
      },
      groupId,
    );
  });

export const addGroupAi = (
  ctx: StoreCtx,
  chatId: string,
  aiId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, ctx.groupIds.get(chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.addGroupAi(groupId, aiId),
      false,
    );
  });

export const removeGroupAi = (
  ctx: StoreCtx,
  chatId: string,
  aiId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroupCore<GroupDetail, Ports>(
      groupChangeStore(ctx, ctx.groupIds.get(chatId)),
      chatId,
      'This group is not available yet.',
      (groupId) => api.removeGroupAi(groupId, aiId),
      false,
    );
  });
