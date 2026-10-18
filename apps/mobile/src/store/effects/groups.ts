import { Effect } from 'effect';
import {
  applyTopicRow as applyTopicRowCore,
  changeTopic as changeTopicCore,
  ensureGroupDetail as ensureGroupDetailCore,
  type GroupActionStore,
  type GroupDetailStore,
  type JoinGroupsHooks,
  type TopicRowStore,
} from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';

import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { Topic } from '../../lib/topics-api';
import type { ChatStoreState } from '../types';
import { makeGroupActions } from './group-actions';
import {
  makeGroupMembershipActions,
  type GroupMembershipActions,
} from './group-membership-actions';
import { makeGroupRolesActions } from './group-roles-actions';
import { makeGroupSettingsActions, type GroupSettingsActions } from './group-settings-actions';
import { Ports } from './ports';
import { failAfter, lift, orElse, type StoreCtx } from './runtime';

export type GroupActions = Pick<
  ChatStoreState,
  | 'groupDetail'
  | 'refreshGroupDetail'
  | 'ensureGroupDetail'
  | 'createTopic'
  | 'patchTopic'
  | 'archiveTopic'
  | 'addTopicAi'
  | 'removeTopicAi'
  | 'addTopicMember'
  | 'removeTopicMember'
  | 'joinTopic'
  | 'leaveTopic'
  | 'listTopicMembers'
  | 'topicPreview'
  | 'listTopicAis'
  | 'listInviteLinks'
  | 'createInviteLink'
  | 'revokeInviteLink'
  | 'previewJoinLink'
  | 'joinByLink'
  | 'createChannel'
  | 'createGroup'
  | 'leaveChannel'
  | 'transferGroupOwner'
  | 'changeGroupMemberRole'
  | 'deleteGroup'
  | 'listChannelMembers'
  | 'changeChannelRole'
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

export interface Groups {
  readonly actions: GroupActions & GroupMembershipActions & GroupSettingsActions;
  /** A load in flight serves every caller. */
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  ensureGroupMembers(chatId: string): Effect.Effect<void, never, Ports>;
  /** `hooks.first` joins before the rest; `hooks.onJoined` fires per joined room. */
  joinGroups(current: XmppCore, me: Me, hooks?: JoinGroupsHooks): Effect.Effect<void, never, Ports>;
}

/** One in-flight load per key (a `Deferred` serves the callers that wait); actions run them as Promises at the store's edge. */
export function makeGroups(ctx: StoreCtx): Groups {
  const { ports, get, set, s, h, fx } = ctx;
  const {
    groupDetails,
    loadingGroupDetails,
    groupRolesById,
    loadingGroupRoles,
    topicRolesById,
    loadingTopicRoles,
    groupMembers,
  } = s;
  const { topics, roles: rolesApi } = ports;

  const bumpRevision = (): void =>
    set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));

  // Publishing fills the sender-name map of every row of the group and bumps the revision so `groupDetail` selectors re-fire.
  const groupDetailStore = (): GroupDetailStore<GroupDetail> => ({
    cached: (groupId) => groupDetails.get(groupId),
    isLoading: (groupId) => loadingGroupDetails.has(groupId),
    begin: (groupId) => {
      loadingGroupDetails.add(groupId);
    },
    finish: (groupId) => {
      loadingGroupDetails.delete(groupId);
    },
    publish: (groupId, detail) => {
      groupDetails.set(groupId, detail);
      for (const row of get().chats) {
        if (row.groupId === detail.id) {
          h.rememberMembers(row.id, detail);
        }
      }
      bumpRevision();
    },
  });

  const ensureGroupDetail = (groupId: string, force = false): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const { api } = yield* Ports;
      yield* ensureGroupDetailCore(api, groupDetailStore(), groupId, force);
    });

  // Fails on a load error so the screen can show Retry.
  const ensureGroupRoles = (groupId: string, force = false): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      if (groupId === '') {
        return;
      }
      if (loadingGroupRoles.has(groupId)) {
        return;
      }
      if (!force && groupRolesById.has(groupId)) {
        return;
      }
      loadingGroupRoles.add(groupId);
      yield* lift(() => rolesApi.listGroupRoles(groupId)).pipe(
        Effect.flatMap((roles) =>
          Effect.sync(() => {
            groupRolesById.set(groupId, roles);
            bumpRevision();
          }),
        ),
        Effect.ensuring(Effect.sync(() => loadingGroupRoles.delete(groupId))),
      );
    });

  const ensureTopicRoles = (chatId: string, force = false): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const topicId = chat?.topic?.id;
      if (topicId === undefined) {
        return;
      }
      if (loadingTopicRoles.has(topicId)) {
        return;
      }
      if (!force && topicRolesById.has(topicId)) {
        return;
      }
      loadingTopicRoles.add(topicId);
      yield* lift(() => topics.getTopic(topicId)).pipe(
        Effect.flatMap((topic) => Effect.sync(() => h.rememberTopicRoles(topic))),
        Effect.ensuring(Effect.sync(() => loadingTopicRoles.delete(topicId))),
      );
    });

  // One GET per group: a typing indicator or a message from a non-contact can still show a name. Never its own `api.getGroup`.
  const ensureGroupMembers = (chatId: string): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      if (groupMembers.has(chatId)) {
        return;
      }
      const groupId = h.groupIdForChat(chatId);
      if (groupId === undefined) {
        return;
      }
      const { api } = yield* Ports;
      const detail = yield* ensureGroupDetailCore(api, groupDetailStore(), groupId, false);
      // A cache hit (or another caller's load) does not publish; fill this chat's sender-name map.
      if (detail !== undefined && !groupMembers.has(chatId)) {
        h.rememberMembers(chatId, detail);
      }
    });

  const joinGroups = (
    current: XmppCore,
    me: Me,
    hooks?: JoinGroupsHooks,
  ): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const chats = get().chats.filter((chat) => chat.kind === 'group');
      const first = hooks?.first;
      const ordered =
        first === undefined
          ? chats
          : [
              ...chats.filter((chat) => chat.id === first),
              ...chats.filter((chat) => chat.id !== first),
            ];
      for (const chat of ordered) {
        const groupId = h.groupIdForChat(chat.id);
        if (groupId !== undefined) {
          ctx.forkSession(ensureGroupDetail(groupId));
        }
        ctx.forkSession(ensureGroupMembers(chat.id));
        yield* orElse(
          lift(() => current.joinRoom(chat.id, h.nick(me))).pipe(
            Effect.tap(() => Effect.sync(() => hooks?.onJoined?.(chat.id))),
          ),
          undefined,
        );
      }
    });

  const topicRowStore = (): TopicRowStore => ({
    getChats: () => ports.api.getChats(),
    summariesFor: (entry) => h.summariesFor(entry as ChatEntry),
    rememberGroupIds: (entries) => h.rememberGroupIds(entries as ChatEntry[]),
    prefRows: () => s.chatPrefRows,
    now: () => ports.now(),
  });

  const applyTopicRow = (topic: Topic): Effect.Effect<void, unknown> =>
    applyTopicRowCore(ctx.coreCtx, topicRowStore(), topic);

  const actionStore = (): GroupActionStore => ({
    groupIdFor: (chatId) => h.groupIdForChat(chatId),
    rows: topicRowStore(),
  });

  const joinRoomQuietly = (rowId: string): Effect.Effect<void, never> => {
    const core = s.core;
    const me = get().me;
    if (core === undefined || me === undefined) {
      return Effect.void;
    }
    return orElse(
      lift(() => core.joinRoom(rowId, h.nick(me))),
      undefined,
    );
  };

  const refreshQuietly: Effect.Effect<void, never, Ports> = Effect.suspend(() =>
    orElse(fx.refreshChats, undefined),
  );

  // The last seat archives the topic, so the row disappears either way.
  const removeTopicMemberEffect = (
    chatId: string,
    userId: string,
  ): Effect.Effect<void, unknown, Ports> =>
    failAfter(
      changeTopicCore(ctx.coreCtx, actionStore(), chatId, (topicId) =>
        topics.removeTopicMember(topicId, userId),
      ),
      () => refreshQuietly,
    );

  const actions: GroupActions & GroupMembershipActions & GroupSettingsActions = {
    ...makeGroupActions(ctx, {
      groupDetails,
      bumpRevision,
      ensureGroupDetail,
      actionStore,
      applyTopicRow,
      joinRoomQuietly,
      refreshQuietly,
      removeTopicMemberEffect,
    }),
    ...makeGroupRolesActions(ctx, {
      groupRolesById,
      topicRolesById,
      bumpRevision,
      ensureGroupRoles,
      ensureTopicRoles,
      actionStore,
    }),
    ...makeGroupMembershipActions(ctx, { ensureGroupDetail, refreshQuietly }),
    ...makeGroupSettingsActions(ctx, { ensureGroupDetail, refreshQuietly }),
  };

  return { actions, ensureGroupDetail, ensureGroupMembers, joinGroups };
}
