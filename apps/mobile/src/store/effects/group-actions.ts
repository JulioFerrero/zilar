import { Effect } from 'effect';
import {
  changeGroup as changeGroupCore,
  changeTopic as changeTopicCore,
  createGroupChannel as createGroupChannelCore,
  createTopic as createTopicCore,
  leaveChannel as leaveChannelCore,
  leaveTopic as leaveTopicCore,
  topicIdFor as topicIdForCore,
  type GroupActionStore,
} from '@zilar/client-core/store';

import type { GroupDetail } from '../../lib/chat-api';
import type {
  ApproverRole,
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  Topic,
  TopicRole,
} from '../../lib/topics-api';
import type { CustomGroupRole } from '../../lib/roles-api';
import type { ChannelMemberRole } from '../../lib/groups-api';
import type { GroupActions } from './groups';
import { Ports } from './ports';
import { lift, orElse, type StoreCtx } from './runtime';

/** The closure helpers and values of `makeGroups` the `GroupActions` body reads. */
export interface GroupActionHelpers {
  readonly groupDetails: Map<string, GroupDetail>;
  readonly groupRolesById: Map<string, CustomGroupRole[]>;
  readonly topicRolesById: Map<string, { roles: TopicRole[]; approverRole: ApproverRole | null }>;
  bumpRevision(): void;
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupRoles(groupId: string, force?: boolean): Effect.Effect<void, unknown>;
  ensureTopicRoles(chatId: string, force?: boolean): Effect.Effect<void, unknown>;
  actionStore(): GroupActionStore;
  applyTopicRow(topic: Topic): Effect.Effect<void, unknown>;
  joinRoomQuietly(rowId: string): Effect.Effect<void, never>;
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
  removeTopicMemberEffect(chatId: string, userId: string): Effect.Effect<void, unknown, Ports>;
}

/** The `GroupActions` object of `makeGroups`, relocated behind its helpers. */
export function makeGroupActions(ctx: StoreCtx, helpers: GroupActionHelpers): GroupActions {
  const { get, h } = ctx;
  const { topics, inviteLinks, roles: rolesApi, groups: groupsApi } = ctx.ports;
  const {
    groupDetails,
    groupRolesById,
    topicRolesById,
    bumpRevision,
    ensureGroupDetail,
    ensureGroupRoles,
    ensureTopicRoles,
    actionStore,
    applyTopicRow,
    joinRoomQuietly,
    refreshQuietly,
    removeTopicMemberEffect,
  } = helpers;

  return {
    groupDetail: (groupId) => {
      // Reading the revision subscribes the selector to detail loads.
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
            // The topic exists on the server now: a failed follow-up re-read
            // must not report "Could not create" (the sheet would invite a
            // retry that makes a duplicate). Refresh best-effort.
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
          // The patch response is the server truth: a private-to-public flip
          // cleared the roles there, so the cache is replaced, not merged.
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
    removeTopicMember: (chatId, userId) => ctx.run(removeTopicMemberEffect(chatId, userId)),
    leaveTopic: (chatId) =>
      ctx.run(
        leaveTopicCore(
          ctx.coreCtx,
          {
            groupIdFor: (chatId) => h.groupIdForChat(chatId),
            currentUserId: () => get().me?.id,
            removeMember: (chatId, userId) => removeTopicMemberEffect(chatId, userId),
          },
          {
            isNotFound: () => false,
            refreshTopicRow: () => Effect.succeed(false),
            refreshChats: () => Effect.void,
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
    // T-0144: channels share the chat-list flow with groups (the detail
    // carries `kind`, the feed row paints the channel). Create validates the
    // input, refreshes the list and returns the new group id (R15).
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
              return groupsApi.createChannel({
                title: trimmed,
                ...(input.description === undefined || input.description.trim() === ''
                  ? {}
                  : { description: input.description.trim() }),
                // T-0228: the public handle rides along trimmed; private creates
                // send neither field.
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
    // T-0214: creating a group mirrors the channel flow (trim the title,
    // refresh the list, return the new group id from the POST answer). No
    // `kind` goes over the wire: missing means group. T-0228: a public group
    // carries the handle in the same step.
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
    // T-0144: leaving a channel removes the caller through the member
    // route, then refreshes the list (the row disappears); the caller
    // navigates away.
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
    // T-0144: the members slice for the channel screen — the full audience
    // for managers, the owner/admins slice for subscribers (never the
    // audience), 404 for strangers. The server enforces the rule; the
    // client renders whatever it answers.
    listChannelMembers: (groupId) => ctx.run(lift(() => groupsApi.listGroupMembers(groupId))),
    // T-0144: promote/demote through the role route (owner only, channels
    // only). The detail refreshes first so the channel screen updates at
    // once, then the chat list — the acting device's rows (myRole, counts)
    // match server truth and the composer bar flips. Demoting the last
    // admin rejects with 409 `channel_needs_admin`.
    changeChannelRole: (chatId, userId, role: ChannelMemberRole) =>
      ctx.run(
        changeGroupCore<void, Ports>(
          {
            resolve: (chatId) => {
              const groupId = h.groupIdForChat(chatId);
              return groupId === undefined ? undefined : { groupId, domain: '' };
            },
            applyDetail: () => {},
            reloadDetail: (groupId) =>
              Effect.gen(function* () {
                yield* ensureGroupDetail(groupId, true);
                bumpRevision();
              }),
            refreshList: () => refreshQuietly,
          },
          chatId,
          'This channel is not available yet.',
          (groupId) => groupsApi.changeGroupMemberRole(groupId, userId, role),
          true,
        ),
      ),
    groupRoles: (groupId) => {
      // Reading the revision subscribes the selector to roles loads, like
      // `groupDetail`.
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
        changeTopicCore(
          ctx.coreCtx,
          actionStore(),
          chatId,
          (topicId) => topics.setTopicRoles(topicId, input as SetTopicRolesInput),
          // The refreshed row carries the server truth: going public cleared
          // the roles there, so no stale roles stay in the store.
          (topic) => h.rememberTopicRoles(topic),
        ),
      ),
    topicRoles: (chatId) => {
      // Reading the revision subscribes the selector to topic-roles loads,
      // like `groupDetail`.
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
