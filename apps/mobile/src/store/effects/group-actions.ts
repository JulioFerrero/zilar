import { Effect } from 'effect';
import { ApiError } from '@zilar/api-contract';
import {
  changeTopic as changeTopicCore,
  createGroupChannel as createGroupChannelCore,
  createTopic as createTopicCore,
  leaveChannel as leaveChannelCore,
  leaveTopic as leaveTopicCore,
  topicIdFor as topicIdForCore,
  type GroupActionStore,
} from '@zilar/client-core/store';

import type { GroupDetail } from '../../lib/chat-api';
import type { CreateTopicInput, PatchTopicInput, Topic } from '../../lib/topics-api';
import type { GroupRolesActions } from './group-roles-actions';
import type { GroupActions, GroupWrite } from './groups';
import { Ports } from './ports';
import { lift, orElse, type StoreCtx } from './runtime';

export interface GroupActionHelpers {
  readonly groupDetails: Map<string, GroupDetail>;
  readonly writeGroup: GroupWrite;
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  actionStore(): GroupActionStore;
  applyTopicRow(topic: Topic): Effect.Effect<void, unknown>;
  joinRoomQuietly(rowId: string): Effect.Effect<void, never>;
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
  removeTopicMemberEffect(chatId: string, userId: string): Effect.Effect<void, unknown, Ports>;
}

export function makeGroupActions(
  ctx: StoreCtx,
  helpers: GroupActionHelpers,
): Omit<GroupActions, keyof GroupRolesActions> {
  const { get, h } = ctx;
  const { topics, inviteLinks, groups: groupsApi } = ctx.ports;
  const {
    groupDetails,
    writeGroup,
    ensureGroupDetail,
    actionStore,
    applyTopicRow,
    joinRoomQuietly,
    refreshQuietly,
    removeTopicMemberEffect,
  } = helpers;

  return {
    groupDetail: (groupId) => {
      // Subscribes the selector to detail loads.
      void get().groupDetailsRevision;
      return groupDetails.get(groupId);
    },
    refreshGroupDetail: (groupId) => {
      ctx.forkSession(ensureGroupDetail(groupId, true));
    },
    ensureGroupDetail: (groupId) => {
      ctx.forkSession(ensureGroupDetail(groupId));
    },
    createTopic: (chatId, input) =>
      ctx.run(
        createTopicCore<Topic>(
          ctx.coreCtx,
          {
            groupIdFor: (chatId) => h.groupIdForChat(chatId),
            rememberTopic: (topic) => h.rememberTopicRoles(topic),
            requireRow: false,
            fallbackRowId: (topic) => topic.chatJid,
            // The topic exists now: a failed follow-up must not report "Could not create" (a retry would duplicate it).
            apply: (topic) => orElse(applyTopicRow(topic), undefined),
            joinRoom: (rowId) => joinRoomQuietly(rowId),
          },
          chatId,
          (groupId) => topics.createTopic(groupId, input as CreateTopicInput),
        ),
      ),
    patchTopic: (chatId, input) =>
      ctx.run(
        changeTopicCore(
          ctx.coreCtx,
          actionStore(),
          chatId,
          (topicId) => topics.patchTopic(topicId, input as PatchTopicInput),
          // The patch response is server truth: a public flip cleared the roles there, so replace, not merge.
          (topic) => h.rememberTopicRoles(topic),
        ),
      ),
    archiveTopic: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdForCore(ctx.coreCtx, actionStore(), chatId);
          const topic = yield* lift(() => topics.archiveTopic(topicId));
          yield* orElse(applyTopicRow(topic), undefined);
          yield* refreshQuietly;
        }),
      ),
    addTopicAi: (chatId, aiId) =>
      ctx.run(
        changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) =>
          topics.addTopicAi(topicId, aiId),
        ),
      ),
    removeTopicAi: (chatId, aiId) =>
      ctx.run(
        changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) =>
          topics.removeTopicAi(topicId, aiId),
        ),
      ),
    addTopicMember: (chatId, userId) =>
      ctx.run(
        changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) =>
          topics.addTopicMember(topicId, userId),
        ),
      ),
    joinTopic: (chatId) =>
      ctx.run(
        changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) => topics.joinTopic(topicId)),
      ),
    removeTopicMember: (chatId, userId) => ctx.run(removeTopicMemberEffect(chatId, userId)),
    leaveTopic: (chatId) =>
      ctx.run(
        leaveTopicCore(
          ctx.coreCtx,
          {
            groupIdFor: (chatId) => h.groupIdForChat(chatId),
            currentUserId: () => get().me?.id,
            // One DELETE, like web: the helper's refresh-on-failure would drop the row before core re-reads the topic id.
            removeMember: (chatId, userId) =>
              changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) =>
                topics.removeTopicMember(topicId, userId),
              ),
          },
          {
            // The last seat archives the topic: the 404 plus the refresh is the leave succeeding.
            isNotFound: (error) => error instanceof ApiError && error.status === 404,
            refreshTopicRow: (chatId, topicId) =>
              Effect.gen(function* () {
                yield* refreshQuietly;
                return !get().chats.some(
                  (chat) => chat.id === chatId || chat.topic?.id === topicId,
                );
              }),
            refreshChats: () => refreshQuietly,
          },
          chatId,
        ),
      ),
    listTopicMembers: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdForCore(ctx.coreCtx, actionStore(), chatId);
          return yield* lift(() => topics.listTopicMembers(topicId));
        }),
      ),
    topicPreview: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdForCore(ctx.coreCtx, actionStore(), chatId);
          return yield* lift(() => topics.topicPreview(topicId));
        }),
      ),
    listTopicAis: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdForCore(ctx.coreCtx, actionStore(), chatId);
          return yield* lift(() => topics.listTopicAis(topicId));
        }),
      ),
    listInviteLinks: (groupId) => ctx.run(lift(() => inviteLinks.listGroupInviteLinks(groupId))),
    createInviteLink: (groupId, input) =>
      ctx.run(lift(() => inviteLinks.createGroupInviteLink(groupId, input))),
    revokeInviteLink: (groupId, linkId) =>
      ctx.run(lift(() => inviteLinks.revokeGroupInviteLink(groupId, linkId))),
    previewJoinLink: (token) => ctx.run(lift(() => inviteLinks.previewJoinLink(token))),
    joinByLink: (token) =>
      ctx.run(
        Effect.gen(function* () {
          const result = yield* lift(() => inviteLinks.joinByLink(token));
          yield* refreshQuietly;
          return result;
        }),
      ),
    createChannel: (input) =>
      ctx.run(
        createGroupChannelCore<{ id: string }, Ports>(
          {
            create: () => {
              const trimmed = input.title.trim();
              if (trimmed === '') {
                throw new Error('Enter a channel name.');
              }
              if (input.description !== undefined && input.description.length > 300) {
                throw new Error('The description must be at most 300 characters.');
              }
              return groupsApi.createGroup({
                title: trimmed,
                kind: 'channel',
                ...(input.description === undefined || input.description.trim() === ''
                  ? {}
                  : { description: input.description.trim() }),
                ...(input.visibility === 'public' && input.handle !== undefined
                  ? { visibility: 'public' as const, handle: input.handle.trim() }
                  : {}),
              });
            },
            refreshAndLocate: () => refreshQuietly.pipe(Effect.as(undefined)),
            requireRow: false,
            result: (_chatJid, detail) => detail.id,
          },
          'the new channel did not appear in the chat list',
        ),
      ),
    createGroup: (input) =>
      ctx.run(
        createGroupChannelCore<{ id: string }, Ports>(
          {
            create: () => {
              const trimmed = input.title.trim();
              if (trimmed === '') {
                throw new Error('Enter a group name.');
              }
              return groupsApi.createGroup({
                title: trimmed,
                memberIds: input.memberIds,
                ...(input.visibility === 'public' && input.handle !== undefined
                  ? { visibility: 'public' as const, handle: input.handle.trim() }
                  : {}),
              });
            },
            refreshAndLocate: () => refreshQuietly.pipe(Effect.as(undefined)),
            requireRow: false,
            result: (_chatJid, detail) => detail.id,
          },
          'the new group did not appear in the chat list',
        ),
      ),
    leaveChannel: (chatId) =>
      ctx.run(
        leaveChannelCore(
          {
            groupIdFor: (chatId) => h.groupIdForChat(chatId),
            currentUserId: () => get().me?.id,
            removeMember: (groupId, userId) =>
              lift(() => groupsApi.removeGroupMember(groupId, userId)),
          },
          refreshQuietly,
          chatId,
        ),
      ),
    transferGroupOwner: (groupId, userId) =>
      writeGroup(groupId, (id) => groupsApi.transferGroupOwner(id, userId)),
    // Keyed by GROUP id (the group-info screen has no chat row); a channel's last-admin demotion rejects with 409 `channel_needs_admin`.
    changeGroupMemberRole: (groupId, userId, role) =>
      writeGroup(groupId, (id) => groupsApi.changeGroupMemberRole(id, userId, role)),
    deleteGroup: (groupId) =>
      ctx.run(
        Effect.gen(function* () {
          yield* lift(() => groupsApi.deleteGroup(groupId));
          yield* refreshQuietly;
        }),
      ),
    // The full audience for managers, the owner/admins slice for subscribers (never the audience); the server enforces it.
    listChannelMembers: (groupId) =>
      ctx.run(
        lift(() => groupsApi.listGroupMembers(groupId)).pipe(
          // `roles` is optional in the contract; every member row carries a list here.
          Effect.map((members) =>
            members.map((member) => ({
              userId: member.userId,
              name: member.name,
              role: member.role,
              roles: member.roles ?? [],
            })),
          ),
        ),
      ),
    // Owner only; the last-admin demotion rejects with 409 `channel_needs_admin`.
    changeChannelRole: (chatId, userId, role: 'admin' | 'member') =>
      writeGroup(
        h.groupIdForChat(chatId) ?? '',
        (groupId) => groupsApi.changeGroupMemberRole(groupId, userId, role),
        'This channel is not available yet.',
      ),
  };
}
