import { Effect } from 'effect';
import {
  applyTopicRow as applyTopicRowCore,
  changeGroup as changeGroupCore,
  changeTopic as changeTopicCore,
  createGroupChannel as createGroupChannelCore,
  createTopic as createTopicCore,
  ensureGroupDetail as ensureGroupDetailCore,
  leaveChannel as leaveChannelCore,
  leaveTopic as leaveTopicCore,
  topicIdFor as topicIdForCore,
  type GroupActionStore,
  type GroupDetailStore,
  type TopicRowStore,
} from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';

import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type {
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  Topic,
} from '../../lib/topics-api';
import type { ChannelMemberRole } from '../../lib/groups-api';
import type { ChatStoreState } from '../types';
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
  const { topics, inviteLinks, roles: rolesApi, groups: groupsApi } = ports;

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

  const actions: GroupActions = {
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

  return { actions, ensureGroupDetail, ensureGroupMembers, joinGroups };
}
