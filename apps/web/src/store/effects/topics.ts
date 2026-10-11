// Topic effects: creating, patching, archiving and leaving a topic, and the
// membership, AI and role changes that repaint its row from the server's
// answer.
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
