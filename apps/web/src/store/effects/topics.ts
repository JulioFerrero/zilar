import { Effect } from 'effect';
import {
  changeTopic,
  createTopic as createTopicAction,
  leaveTopic as leaveTopicAction,
} from '@zilar/client-core/store';
import {
  ApiError,
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type Topic,
} from '@/lib/api';
import type { StoreCtx } from './ctx';
import { actionStore, applyTopicRow, joinRoomQuietly } from './groupShared';
import { openHistory, refreshChats, refreshChatsOrThrow } from './history';
import { Ports } from './ports';

// Resolves General from the painted list, refreshing it first.
export const refreshGeneralTopic = (
  ctx: StoreCtx,
  groupId: string,
): Effect.Effect<string | undefined, never, Ports> =>
  Effect.gen(function* () {
    yield* refreshChats(ctx);
    const chats = ctx.get().chats;
    // A channel's row has no groupId or topic; ctx.groupIds maps its id to the group.
    return (
      chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true)?.id ??
      chats.find((chat) => ctx.groupIds.get(chat.id) === groupId && chat.topic === undefined)?.id
    );
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
        // A deliberate self-archive moves silently: the header navigates to General itself.
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

// Joins a public topic; the row is repainted from the answer, so it moves to Your topics.
export const joinTopic = (ctx: StoreCtx, chatId: string): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    yield* changeTopic(ctx, actionStore(ctx), chatId, (topicId) => api.joinTopic(topicId));
  });

// A 404 here does not always mean the topic is gone: the server also 404s for a non-member.
// Rethrow as-is; the caller re-checks the row via refreshTopicRow.
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

// Re-reads the chat list and reports whether the topic row is still there.
export const refreshTopicRow = (
  ctx: StoreCtx,
  chatId: string,
  topicId: string,
): Effect.Effect<boolean, unknown, Ports> =>
  Effect.gen(function* () {
    yield* refreshChatsOrThrow(ctx);
    return !ctx.get().chats.some((chat) => chat.id === chatId || chat.topic?.id === topicId);
  });

// Leaving the last seat archives the topic, and the row refreshes itself away. Any other
// 404 means nothing left to leave, but the live row must say so: refresh first and swallow
// only when the topic really disappeared; otherwise rethrow so the caller shows the error.
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
