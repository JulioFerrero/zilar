import { Deferred, Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';

import type { Me } from '../../lib/chat-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
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
    groupIds,
    groupDetails,
    loadingGroupDetails,
    groupRolesById,
    loadingGroupRoles,
    topicRolesById,
    loadingTopicRoles,
    groupMembers,
    loadingGroupMembers,
  } = s;
  const { topics, inviteLinks, roles: rolesApi, groups: groupsApi } = ports;

  const bumpRevision = (): void =>
    set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));

  // Waiters (e.g. `ensureGroupMembers`) subscribe through
  // `groupDetailSettled` so one in-flight GET serves them all.
  const groupDetailWaiters = new Map<string, Set<Deferred.Deferred<void>>>();

  // Resolves once the in-flight detail load for a group settles (success
  // or failure), so waiters share the single GET instead of fetching.
  const groupDetailSettled = (groupId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const waiter = Deferred.makeUnsafe<void>();
      let waiting = groupDetailWaiters.get(groupId);
      if (waiting === undefined) {
        waiting = new Set();
        groupDetailWaiters.set(groupId, waiting);
      }
      waiting.add(waiter);
      return Deferred.await(waiter);
    });

  function notifyGroupDetailSettled(groupId: string): void {
    const waiting = groupDetailWaiters.get(groupId);
    if (waiting === undefined) {
      return;
    }
    groupDetailWaiters.delete(groupId);
    for (const waiter of waiting) {
      Deferred.doneUnsafe(waiter, Effect.void);
    }
  }

  // Loads the group detail (people + roles + AIs) of a group once, so the
  // topics screen, the owner picker and the role checks can read it. The
  // detail is published through `set()` so `groupDetail` selectors re-fire.
  const ensureGroupDetail = (groupId: string, force = false): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const { api } = yield* Ports;
      if (groupId === '') {
        return;
      }
      if (loadingGroupDetails.has(groupId)) {
        return;
      }
      if (!force && groupDetails.has(groupId)) {
        return;
      }
      loadingGroupDetails.add(groupId);
      // The sheet falls back to an empty member list and hides creation.
      yield* orElse(
        Effect.gen(function* () {
          const detail = yield* lift(() => api.getGroup(groupId));
          groupDetails.set(groupId, detail);
          // Publishing a monotonically increasing revision notifies every
          // `groupDetail(groupId)` subscriber, including screens mounted before
          // the fetch resolved.
          bumpRevision();
        }),
        undefined,
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            loadingGroupDetails.delete(groupId);
            notifyGroupDetailSettled(groupId);
          }),
        ),
      );
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

  // Loads the member names of a group once per chat, so a typing indicator
  // or a message from a member who is not a contact can still show a name.
  // T-0147: resolves through the shared group detail only — never its own
  // `api.getGroup`. When no detail is cached or in flight, this starts the
  // shared detail load itself (which fills the detail cache), so concurrent
  // rows collapse into one GET however they arrive.
  const ensureGroupMembers = (chatId: string): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      if (groupMembers.has(chatId) || loadingGroupMembers.has(chatId)) {
        return;
      }
      const groupId = h.groupIdForChat(chatId);
      if (groupId === undefined) {
        return;
      }
      const cached = groupDetails.get(groupId);
      if (cached !== undefined) {
        h.rememberMembers(chatId, cached);
        return;
      }
      loadingGroupMembers.add(chatId);
      yield* Effect.gen(function* () {
        // Starts the shared detail load when nothing is in flight (a no-op
        // when someone else already started it), then waits for it: one GET
        // serves every topic row of the group, and the fallback fills the
        // detail cache instead of a side map.
        yield* ensureGroupDetail(groupId);
        let settled = groupDetails.get(groupId);
        if (settled === undefined && loadingGroupDetails.has(groupId)) {
          yield* groupDetailSettled(groupId);
          settled = groupDetails.get(groupId);
        }
        if (settled === undefined) {
          return;
        }
        h.rememberMembers(chatId, settled);
      }).pipe(Effect.ensuring(Effect.sync(() => loadingGroupMembers.delete(chatId))));
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

  // One topic row refreshed from the server (create/patch/member/AI):
  // re-reads `/api/chats`, merges the row, and preserves its local state.
  const applyTopicRow = (topic: Topic): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const entries = yield* lift(() => ports.api.getChats());
      h.rememberGroupIds(entries);
      const rows = entries.flatMap((entry) => h.summariesFor(entry));
      const match = rows.find((row) => row.topic?.id === topic.id);
      set((state) => {
        if (match === undefined) {
          return state;
        }
        const before = state.chats.find((chat) => chat.id === match.id);
        const prefed = applyChatPrefs([match], s.chatPrefRows, ports.now().getTime())[0] ?? match;
        const merged: ChatSummary =
          before === undefined
            ? prefed
            : {
                ...prefed,
                ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
                unread: before.unread,
                ...(before.online === undefined ? {} : { online: before.online }),
                ...(before.onlineCount === undefined ? {} : { onlineCount: before.onlineCount }),
              };
        return {
          chats: state.chats.some((chat) => chat.id === merged.id)
            ? state.chats.map((chat) => (chat.id === merged.id ? merged : chat))
            : h.sortByRecency([...state.chats, merged]),
        };
      });
    });

  // The topic id + group id of the topic that owns `chatId`. Fails for a
  // chat that is not a topic yet (e.g. a legacy group row).
  const topicIdFor = (chatId: string): Effect.Effect<{ topicId: string; groupId: string }, Error> =>
    Effect.suspend(() => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const topicId = chat?.topic?.id;
      const groupId = chat?.groupId ?? groupIds.get(chatId);
      if (topicId === undefined || groupId === undefined) {
        return Effect.fail(new Error('This topic is not available yet.'));
      }
      return Effect.succeed({ topicId, groupId });
    });

  // A best-effort refresh of the chat list: its failure is dropped.
  const refreshQuietly: Effect.Effect<void, never, Ports> = Effect.suspend(() =>
    orElse(fx.refreshChats, undefined),
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
        Effect.gen(function* () {
          const chat = get().chats.find((entry) => entry.id === chatId);
          const groupId = chat?.groupId ?? groupIds.get(chatId);
          if (groupId === undefined) {
            return yield* Effect.fail(new Error('This group is not available yet.'));
          }
          const topic = yield* lift(() => topics.createTopic(groupId, input as CreateTopicInput));
          h.rememberTopicRoles(topic);
          // The topic exists on the server now: a failed follow-up re-read
          // must not report "Could not create" (the sheet would invite a
          // retry that makes a duplicate). Refresh best-effort and fall back
          // to the created topic's own chat JID.
          yield* orElse(applyTopicRow(topic), undefined);
          const row = get().chats.find((entry) => entry.topic?.id === topic.id);
          const rowId = row?.id ?? topic.chatJid;
          const me = get().me;
          const core = s.core;
          if (core !== undefined && me !== undefined) {
            yield* orElse(
              lift(() => core.joinRoom(rowId, h.nick(me))),
              undefined,
            );
          }
          return rowId;
        }),
      ),
    patchTopic: (chatId, input) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() => topics.patchTopic(topicId, input as PatchTopicInput));
          // The patch response is the server truth: a private-to-public flip
          // cleared the roles there, so the cache is replaced, not merged.
          h.rememberTopicRoles(topic);
          yield* applyTopicRow(topic);
        }),
      ),
    archiveTopic: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() => topics.archiveTopic(topicId));
          yield* orElse(applyTopicRow(topic), undefined);
          yield* refreshQuietly;
        }),
      ),
    addTopicAi: (chatId, aiId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() => topics.addTopicAi(topicId, aiId));
          yield* applyTopicRow(topic);
        }),
      ),
    removeTopicAi: (chatId, aiId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() => topics.removeTopicAi(topicId, aiId));
          yield* applyTopicRow(topic);
        }),
      ),
    addTopicMember: (chatId, userId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() => topics.addTopicMember(topicId, userId));
          yield* applyTopicRow(topic);
        }),
      ),
    removeTopicMember: (chatId, userId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          // Removing the last member archives the topic (server 404): it is
          // gone from the visible list either way, so refresh like the
          // removed-while-open flow.
          yield* failAfter(
            lift(() => topics.removeTopicMember(topicId, userId)).pipe(
              Effect.flatMap((topic) => applyTopicRow(topic)),
            ),
            () => refreshQuietly,
          );
        }),
      ),
    leaveTopic: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const me = get().me;
          if (me === undefined) {
            return yield* Effect.fail(new Error('This topic is not available yet.'));
          }
          yield* lift(() => get().removeTopicMember(chatId, me.id));
        }),
      ),
    listTopicMembers: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          return yield* lift(() => topics.listTopicMembers(topicId));
        }),
      ),
    listTopicAis: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
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
    // carries `kind`, the feed row paints the channel). Create refreshes
    // the list and returns the new group id from the POST answer.
    createChannel: (input) =>
      ctx.run(
        Effect.gen(function* () {
          const trimmed = input.title.trim();
          if (trimmed === '') {
            return yield* Effect.fail(new Error('Enter a channel name.'));
          }
          if (input.description !== undefined && input.description.length > 300) {
            return yield* Effect.fail(new Error('The description must be at most 300 characters.'));
          }
          const created = yield* lift(() =>
            groupsApi.createChannel({
              title: trimmed,
              ...(input.description === undefined || input.description.trim() === ''
                ? {}
                : { description: input.description.trim() }),
              // T-0228: the public handle rides along trimmed; private creates
              // send neither field.
              ...(input.visibility === 'public' && input.handle !== undefined
                ? { visibility: 'public' as const, handle: input.handle.trim() }
                : {}),
            }),
          );
          yield* refreshQuietly;
          return created.id;
        }),
      ),
    // T-0214: creating a group mirrors the channel flow (trim the
    // title, refresh the list, return the new group id from the POST
    // answer). No `kind` goes over the wire: missing means group.
    // T-0228: a public group carries the handle in the same step.
    createGroup: (input) =>
      ctx.run(
        Effect.gen(function* () {
          const trimmed = input.title.trim();
          if (trimmed === '') {
            return yield* Effect.fail(new Error('Enter a group name.'));
          }
          const created = yield* lift(() =>
            groupsApi.createGroup({
              title: trimmed,
              memberIds: input.memberIds,
              ...(input.visibility === 'public' && input.handle !== undefined
                ? { visibility: 'public' as const, handle: input.handle.trim() }
                : {}),
            }),
          );
          yield* refreshQuietly;
          return created.id;
        }),
      ),
    // T-0144: leaving a channel removes the caller through the member
    // route, then refreshes the list (the row disappears); the caller
    // navigates away.
    leaveChannel: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const groupId = h.groupIdForChat(chatId);
          const me = get().me;
          if (groupId === undefined || me?.id === undefined) {
            return yield* Effect.fail(new Error('This channel is not available yet.'));
          }
          yield* lift(() => groupsApi.removeGroupMember(groupId, me.id));
          yield* refreshQuietly;
        }),
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
        Effect.gen(function* () {
          const groupId = h.groupIdForChat(chatId);
          if (groupId === undefined) {
            return yield* Effect.fail(new Error('This channel is not available yet.'));
          }
          yield* lift(() => groupsApi.changeGroupMemberRole(groupId, userId, role));
          yield* ensureGroupDetail(groupId, true);
          bumpRevision();
          yield* refreshQuietly;
        }),
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
        Effect.gen(function* () {
          const { topicId } = yield* topicIdFor(chatId);
          const topic = yield* lift(() =>
            topics.setTopicRoles(topicId, input as SetTopicRolesInput),
          );
          // The refreshed row carries the server truth: going public cleared
          // the roles there, so no stale roles stay in the store.
          h.rememberTopicRoles(topic);
          yield* applyTopicRow(topic);
        }),
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
