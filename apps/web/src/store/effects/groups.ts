// Groups, topics, channels, roles and members: loading a group's members,
// joining rooms, and the actions that change a group or topic on the server
// and then repaint the chat list or the group detail from the answer.
import { Effect } from 'effect';
import {
  applyTopicRow as applyTopicRowCore,
  changeTopic,
  createTopic as createTopicAction,
  leaveTopic as leaveTopicAction,
  type GroupActionStore,
  type TopicRowStore,
} from '@zilar/client-core/store';
import {
  ApiError,
  type ChatEntry,
  type ChatPref,
  type CreateTopicInput,
  type GroupBackground,
  type GroupDetail,
  type PatchTopicInput,
  type SetGroupListenerInput,
  type SetTopicRolesInput,
  type Topic,
} from '@/lib/api';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { sortByRecency, summariesFor } from './chatRows';
import type { StoreCtx } from './ctx';
import { applyGroupDetail, domainOf, ensureGroupMembers } from './groupMembers';
import { openHistory, refreshChats, refreshChatsOrThrow } from './history';
import { Ports } from './ports';
import { fromPromise, prefsByJid } from './util';

type CreateOptions = {
  kind?: 'group' | 'channel';
  description?: string;
  visibility?: 'private' | 'public';
  handle?: string;
};

/** The group a chat belongs to: from its row first, else from the ids remembered. */
const groupIdOf = (ctx: StoreCtx, chatId: string): string | undefined =>
  ctx.get().chats.find((entry) => entry.id === chatId)?.groupId ?? ctx.groupIds.get(chatId);

// The group id and my XMPP domain, or the fixed "not available yet" failure.
const resolveGroup = (
  ctx: StoreCtx,
  groupId: string | undefined,
  notAvailable: string,
): Effect.Effect<{ groupId: string; domain: string }, Error> => {
  const mine = ctx.k.myJid();
  if (groupId === undefined || mine === undefined) {
    return Effect.fail(new Error(notAvailable));
  }
  return Effect.succeed({ groupId, domain: domainOf(mine) });
};

/** The web half of the core topic-row refresh (R17): `/api/chats` and prefs. */
const topicRowStore = (ctx: StoreCtx): TopicRowStore => ({
  getChats: () => ctx.ports.api.getChats(),
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
  rememberGroupIds: (entries) => ctx.k.rememberGroupIds(entries as ChatEntry[]),
  prefRows: () => Object.values(ctx.get().chatPrefs),
  now: () => ctx.ports.now(),
});

const applyTopicRow = (ctx: StoreCtx, topic: Topic): Effect.Effect<void, unknown> =>
  applyTopicRowCore(ctx, topicRowStore(ctx), topic);

// The web half of the shared topic actions: the group ids remembered beside
// the rows, and the topic-row store the shared repaint uses (R17).
const actionStore = (ctx: StoreCtx): GroupActionStore => ({
  groupIdFor: (chatId) => ctx.groupIds.get(chatId),
  rows: topicRowStore(ctx),
});

// Joins a topic's room, ignoring a failure (the created row is already painted).
const joinRoomQuietly = (ctx: StoreCtx, rowId: string): Effect.Effect<void, never> => {
  const me = ctx.get().me;
  const current = ctx.core;
  if (current === undefined || me === undefined) {
    return Effect.void;
  }
  return fromPromise(() => current.joinRoom(rowId, ctx.k.nick(me))).pipe(Effect.ignore);
};

// Resolves General from the painted list, refreshing it first.
export const refreshGeneralTopic = (
  ctx: StoreCtx,
  groupId: string,
): Effect.Effect<string | undefined, never, Ports> =>
  Effect.gen(function* () {
    yield* refreshChats(ctx);
    return ctx
      .get()
      .chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true)?.id;
  });

export const createTopic = (
  ctx: StoreCtx,
  chatId: string,
  input: CreateTopicInput,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const id = yield* createTopicAction<Topic>(
      ctx,
      {
        groupIdFor: (chatId) => ctx.groupIds.get(chatId),
        requireRow: true,
        fallbackRowId: () => '',
        apply: (topic) => applyTopicRow(ctx, topic),
        joinRoom: (rowId) => joinRoomQuietly(ctx, rowId),
      },
      chatId,
      (groupId) => api.createTopic(groupId, input),
    );
    yield* openHistory(ctx, id);
    return id;
  });

export const patchTopic = (
  ctx: StoreCtx,
  chatId: string,
  input: PatchTopicInput,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(
      ctx,
      actionStore(ctx),
      chatId,
      (topicId) => api.patchTopic(topicId, input),
      (topic) => {
        // A deliberate self-archive moves silently: the header already
        // navigates to General itself, so the removed-while-open flow must
        // not add a "no longer available" notice on top of it.
        if (topic.archived && ctx.get().activeChatId === chatId) {
          ctx.quietArchiveIds.add(chatId);
        }
      },
    );
  });

export const addTopicAi = (
  ctx: StoreCtx,
  chatId: string,
  aiId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) => api.addTopicAi(topicId, aiId));
  });

export const removeTopicAi = (
  ctx: StoreCtx,
  chatId: string,
  aiId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) =>
      api.removeTopicAi(topicId, aiId),
    );
  });

export const addTopicMember = (
  ctx: StoreCtx,
  chatId: string,
  userId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) =>
      api.addTopicMember(topicId, userId),
    );
  });

// ONE DELETE. A 404 here does not always mean the topic is gone: the server
// also 404s for a user who is not a member (e.g. a stale member list, or a
// second click on Remove). Rethrow as-is; the caller re-checks the row via
// `refreshTopicRow`.
export const removeTopicMember = (
  ctx: StoreCtx,
  chatId: string,
  userId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) =>
      api.removeTopicMember(topicId, userId),
    );
  });

export const setTopicRoles = (
  ctx: StoreCtx,
  chatId: string,
  input: SetTopicRolesInput,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) =>
      api.setTopicRoles(topicId, input),
    );
  });

// T-0130 (review): re-reads the chat list and reports whether the topic row
// is gone, so a member-removal 404 can be told apart from a gone topic (last
// member removed → archived). A failed refresh throws (instead of reading a
// stale list as "alive"), so the panel shows the inline removal error.
export const refreshTopicRow = (
  ctx: StoreCtx,
  chatId: string,
  topicId: string,
): Effect.Effect<boolean, unknown, Ports> =>
  Effect.gen(function* () {
    yield* refreshChatsOrThrow(ctx);
    return !ctx.get().chats.some((chat) => chat.id === chatId || chat.topic?.id === topicId);
  });

// Leaving the last seat archives the topic: the server answers 404 `Topic not
// found`, and the row refreshes itself away — the caller navigates away. Any
// other 404 (e.g. "not a member") means nothing left to leave either, but the
// live row must say so: refresh the list first and swallow only when the topic
// really disappeared from it. Otherwise rethrow, so the caller shows the
// normal error instead of navigating away. The core `leaveTopic` keeps this.
export const leaveTopic = (ctx: StoreCtx, chatId: string): Effect.Effect<void, unknown, Ports> =>
  leaveTopicAction(
    ctx,
    {
      groupIdFor: (chatId) => ctx.groupIds.get(chatId),
      currentUserId: () => ctx.get().me?.id,
      removeMember: (chatId, userId) => removeTopicMember(ctx, chatId, userId),
    },
    {
      isNotFound: (error) => error instanceof ApiError && error.status === 404,
      refreshTopicRow: (chatId, topicId) => refreshTopicRow(ctx, chatId, topicId),
      refreshChats: () => refreshChats(ctx),
    },
    chatId,
  );

// Creates a group or channel, repaints the chat list from the server (keeping
// what is already painted), joins its room and opens it.
const createAndOpen = (
  ctx: StoreCtx,
  create: () => Promise<GroupDetail>,
  notFound: string,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    const detail = yield* fromPromise(create);
    const [entries, prefs] = yield* Effect.all(
      [
        fromPromise(() => api.getChats()),
        fromPromise(() => api.listChatPrefs()).pipe(
          Effect.catchCause(() => Effect.succeed([] as ChatPref[])),
        ),
      ],
      { concurrency: 'unbounded' },
    );
    ctx.k.rememberGroupIds(entries);
    const previous = ctx.get().chats;
    const freshRows = entries.flatMap((entry) => summariesFor(entry));
    ctx.set({
      chats: applyChatPrefs(
        sortByRecency(
          freshRows.map((row) => {
            const before = previous.find((chat) => chat.id === row.id);
            return before === undefined
              ? row
              : {
                  ...row,
                  ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
                  unread: before.unread,
                  ...(before.online === undefined ? {} : { online: before.online }),
                };
          }),
        ),
        prefs,
        now().getTime(),
      ),
      chatPrefs: prefsByJid(prefs),
    });
    const created = entries.find((entry) => entry.kind === 'group' && entry.groupId === detail.id);
    if (created === undefined) {
      return yield* Effect.fail(new Error(notFound));
    }
    const me = ctx.get().me;
    const current = ctx.core;
    if (current !== undefined && me !== undefined) {
      yield* fromPromise(() => current.joinRoom(created.chatJid, ctx.k.nick(me))).pipe(
        Effect.ignore,
      );
    }
    ctx.rt.fork(ensureGroupMembers(ctx, created.chatJid));
    yield* openHistory(ctx, created.chatJid);
    return created.chatJid;
  });

// T-0124: channels share the create/list/refresh flow with groups (the detail
// carries `kind`, the chat list paints the feed row). T-0164: `visibility:
// 'public'` + `handle` creates the channel with its directory entry in one
// transaction.
export const createChannel = (
  ctx: StoreCtx,
  title: string,
  memberIds: string[],
  description: string | undefined,
  options: { visibility?: 'private' | 'public'; handle?: string } | undefined,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* createAndOpen(
      ctx,
      () =>
        api.createGroup({
          title,
          memberIds,
          kind: 'channel',
          ...(description === undefined || description.trim() === ''
            ? {}
            : { description: description.trim() }),
          ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
          ...(options?.handle === undefined ? {} : { handle: options.handle }),
        }),
      'the new channel did not appear in the chat list',
    );
  });

// T-0124: channels share this entry point (the dialog passes `kind` and
// `description` through the same call). T-0164: `visibility: 'public'` +
// `handle` creates the group with its directory entry in one transaction.
export const createGroup = (
  ctx: StoreCtx,
  title: string,
  memberIds: string[],
  options: CreateOptions | undefined,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* createAndOpen(
      ctx,
      () =>
        api.createGroup({
          title,
          memberIds,
          ...(options?.kind === undefined ? {} : { kind: options.kind }),
          ...(options?.description === undefined ? {} : { description: options.description }),
          ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
          ...(options?.handle === undefined ? {} : { handle: options.handle }),
        }),
      'the new group did not appear in the chat list',
    );
  });

// T-0124: leaving a channel removes the caller's membership through the member
// route (the same route admins use to remove others). The list refreshes
// itself away; the caller navigates away.
export const leaveChannel = (ctx: StoreCtx, chatId: string): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const groupId = ctx.groupIds.get(chatId);
    const me = ctx.get().me;
    if (groupId === undefined || me === undefined) {
      return yield* Effect.fail(new Error('This channel is not available yet.'));
    }
    yield* fromPromise(() => api.removeGroupMember(groupId, me.id));
    yield* refreshChatsOrThrow(ctx);
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
    const { groupId, domain } = yield* resolveGroup(
      ctx,
      ctx.groupIds.get(chatId),
      'This channel is not available yet.',
    );
    const detail = yield* fromPromise(() => api.changeGroupMemberRole(groupId, userId, role));
    applyGroupDetail(ctx, chatId, detail, domain);
    yield* refreshChatsOrThrow(ctx);
  });

// A group call whose answer is the new detail: resolve the group of the chat,
// call the route, repaint the detail, and optionally refresh the list.
const changeGroup = (
  ctx: StoreCtx,
  chatId: string,
  groupId: string | undefined,
  notAvailable: string,
  call: (groupId: string) => Promise<GroupDetail>,
  refreshList: boolean,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const resolved = yield* resolveGroup(ctx, groupId, notAvailable);
    const detail = yield* fromPromise(() => call(resolved.groupId));
    applyGroupDetail(ctx, chatId, detail, resolved.domain);
    if (refreshList) {
      yield* refreshChatsOrThrow(ctx);
    }
  });

export const setMembersCanCreateTopics = (
  ctx: StoreCtx,
  chatId: string,
  allowed: boolean,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroup(
      ctx,
      chatId,
      groupIdOf(ctx, chatId),
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
    yield* changeGroup(
      ctx,
      chatId,
      groupIdOf(ctx, chatId),
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
    yield* changeGroup(
      ctx,
      chatId,
      groupIdOf(ctx, chatId),
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
    yield* changeGroup(
      ctx,
      chatId,
      groupIdOf(ctx, chatId),
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
    yield* fromPromise(() => api.joinPublicGroup(groupId));
    yield* refreshChatsOrThrow(ctx);
    return ctx
      .get()
      .chats.find((entry) => entry.groupId === groupId && entry.topic?.isGeneral !== false)?.id;
  });

export const addGroupAi = (
  ctx: StoreCtx,
  chatId: string,
  aiId: string,
): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeGroup(
      ctx,
      chatId,
      ctx.groupIds.get(chatId),
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
    yield* changeGroup(
      ctx,
      chatId,
      ctx.groupIds.get(chatId),
      'This group is not available yet.',
      (groupId) => api.removeGroupAi(groupId, aiId),
      false,
    );
  });

export const createInvite = (): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    const invite = yield* fromPromise(() => api.createInvite());
    return invite.url;
  });
