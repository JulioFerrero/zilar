import { Effect } from 'effect';
import {
  applyTopicRow as applyTopicRowCore,
  changeTopic as changeTopicCore,
  ensureGroupDetail as ensureGroupDetailCore,
  type GroupActionStore,
  type GroupDetailStore,
  type TopicRowStore,
} from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';

import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { Topic } from '../../lib/topics-api';
import type { ChatStoreState } from '../types';
import { makeGroupActions } from './group-actions';
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
  | 'leaveTopic'
  | 'listTopicMembers'
  | 'listTopicAis'
  | 'listInviteLinks'
  | 'createInviteLink'
  | 'revokeInviteLink'
  | 'previewJoinLink'
  | 'joinByLink'
  | 'createChannel'
  | 'createGroup'
  | 'leaveChannel'
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
  readonly actions: GroupActions;
  /** Loads the detail of a group once; `force` reloads it. A load in flight serves every caller. */
  ensureGroupDetail(groupId: string, force?: boolean): Effect.Effect<void, never, Ports>;
  /** The member names of a chat's group, from the shared detail load. */
  ensureGroupMembers(chatId: string): Effect.Effect<void, never, Ports>;
  /** Joins the rooms of every group chat, one at a time; a room can be joined later. */
  joinGroups(current: XmppCore, me: Me): Effect.Effect<void, never, Ports>;
}

/**
 * Groups, topics, channels, roles and members. The loaders are Effects with
 * one in-flight load per key (a `Deferred` serves the callers that wait for
 * it); the actions run them as Promises at the store's edge.
 */
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

  // The mobile view of the core's per-group cache (T-0920): the detail map and
  // the in-flight marks are the store's own (group-keyed); publishing fills the
  // sender-name map of every row of the group and bumps the revision so
  // `groupDetail` selectors re-fire.
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

  // Loads the group detail (people + roles + AIs) of a group once, so the
  // topics screen, the owner picker and the role checks can read it. The
  // detail is published through `set()` so `groupDetail` selectors re-fire.
  const ensureGroupDetail = (groupId: string, force = false): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const { api } = yield* Ports;
      yield* ensureGroupDetailCore(api, groupDetailStore(), groupId, force);
    });

  // Loads the custom roles (T-0137) of a group once, so the group screen
  // and the topic access sheet can read them. Published through `set()`
  // (the `groupDetailsRevision` bump) so `groupRoles` selectors re-fire.
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

  // Loads the attached roles + approver role of the topic that owns
  // `chatId` once, so the topic info sheet can read them. Fails on a load
  // error so the sheet can show Retry.
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

  // Loads the member names of a group once per group, so a typing indicator or
  // a message from a member who is not a contact can still show a name, and
  // every topic row of the group shares one GET (R14). Resolves through the
  // shared group detail only — never its own `api.getGroup`.
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
      // A pure cache hit (or a load another caller started) does not publish;
      // fill this chat's sender-name map, which publish may not have reached.
      if (detail !== undefined && !groupMembers.has(chatId)) {
        h.rememberMembers(chatId, detail);
      }
    });

  const joinGroups = (current: XmppCore, me: Me): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      for (const chat of get().chats) {
        if (chat.kind !== 'group') {
          continue;
        }
        // The detail first: it fills the cache, so the member-name fallback
        // behind every topic row shares the same GET (T-0147 ordering).
        const groupId = h.groupIdForChat(chat.id);
        if (groupId !== undefined) {
          ctx.forkSession(ensureGroupDetail(groupId));
        }
        ctx.forkSession(ensureGroupMembers(chat.id));
        // A room can be joined later when the user opens it.
        yield* orElse(
          lift(() => current.joinRoom(chat.id, h.nick(me))),
          undefined,
        );
      }
    });

  // The mobile half of the core topic-row refresh (R17): `/api/chats` and the
  // store's saved pref rows.
  const topicRowStore = (): TopicRowStore => ({
    getChats: () => ports.api.getChats(),
    summariesFor: (entry) => h.summariesFor(entry as ChatEntry),
    rememberGroupIds: (entries) => h.rememberGroupIds(entries as ChatEntry[]),
    prefRows: () => s.chatPrefRows,
    now: () => ports.now(),
  });

  // One topic row refreshed from the server (create/patch/member/AI): the core
  // re-reads `/api/chats`, drops an archived topic and preserves local state.
  const applyTopicRow = (topic: Topic): Effect.Effect<void, unknown> =>
    applyTopicRowCore(ctx.coreCtx, topicRowStore(), topic);

  // The mobile half of the shared topic actions: the group id of a chat and
  // the topic-row store the shared repaint uses (R17).
  const actionStore = (): GroupActionStore => ({
    groupIdFor: (chatId) => h.groupIdForChat(chatId),
    rows: topicRowStore(),
  });

  // Joins a topic's room, dropping a failure (the created row is painted).
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

  // A best-effort refresh of the chat list: its failure is dropped.
  const refreshQuietly: Effect.Effect<void, never, Ports> = Effect.suspend(() =>
    orElse(fx.refreshChats, undefined),
  );

  // Removes the caller from a topic and refreshes the list on a failure (the
  // last seat archives the topic, so the row disappears either way).
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

  const actions = makeGroupActions(ctx, {
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
  });

  return { actions, ensureGroupDetail, ensureGroupMembers, joinGroups };
}
