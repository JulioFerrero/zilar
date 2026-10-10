// Group and topic actions shared by both stores (phase 2b): the topic routes
// (create, patch, AI and member changes, roles) and the leave flow. Where the
// two apps differ (web opens the new topic, mobile returns its group id; web
// re-checks a gone topic, mobile does not) a small app adapter keeps each
// app's behaviour while the sequence and the row repaint live in one place.
import { Cause, Effect, Exit } from 'effect';
import { fromPromise, type CoreCtx } from './ctx';
import { applyTopicRow, type TopicRowStore } from './groups';

/** The fields the shared actions read of a topic row. */
export interface TopicRow {
  readonly id: string;
  readonly archived?: boolean | undefined;
}

/** The app half of the shared group and topic actions. */
export interface GroupActionStore {
  /** The group id of a chat row, from the store's own remembered map. */
  groupIdFor(chatId: string): string | undefined;
  /** The topic-row store a refreshed row is repainted through (R17). */
  rows: TopicRowStore;
}

/** The topic id and group id of the topic that owns `chatId`. */
export function topicIdFor(
  ctx: CoreCtx,
  store: Pick<GroupActionStore, 'groupIdFor'>,
  chatId: string,
): Effect.Effect<{ topicId: string; groupId: string }, Error> {
  return Effect.suspend(() => {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const topicId = chat?.topic?.id;
    const groupId = chat?.groupId ?? store.groupIdFor(chatId);
    if (topicId === undefined || groupId === undefined) {
      return Effect.fail(new Error('This topic is not available yet.'));
    }
    return Effect.succeed({ topicId, groupId });
  });
}

/** Calls a topic route for the chat's topic, then repaints that topic's row. */
export function changeTopic<T extends TopicRow>(
  ctx: CoreCtx,
  store: GroupActionStore,
  chatId: string,
  call: (topicId: string) => Promise<T>,
  before?: (topic: T) => void,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { topicId } = yield* topicIdFor(ctx, store, chatId);
    const topic = yield* fromPromise(() => call(topicId));
    before?.(topic);
    yield* applyTopicRow(ctx, store.rows, topic);
  });
}

/** The app half of `createTopic`. */
export interface CreateTopicStore<T extends TopicRow> {
  /** The group id of a chat row, from the store's own remembered map. */
  groupIdFor(chatId: string): string | undefined;
  /** Remembers the created topic's roles (mobile); web has none. */
  rememberTopic?(topic: T): void;
  /** Repaints the new topic's row; mobile swallows a failed re-read, web does not. */
  apply(topic: T): Effect.Effect<void, unknown>;
  /** True to fail when the new topic is not in the list (web). */
  requireRow: boolean;
  /** The row id used when the list has not caught up (mobile: the response's chat JID). */
  fallbackRowId(topic: T): string;
  /** Joins the topic's room once its row id is known. */
  joinRoom(rowId: string): Effect.Effect<void, unknown>;
}

/**
 * Creates a topic through the app's route, repaints its row, joins its room
 * and answers the row id. Web fails when the new topic is missing from the
 * list; mobile falls back to the response's own chat JID.
 */
export function createTopic<T extends TopicRow>(
  ctx: CoreCtx,
  store: CreateTopicStore<T>,
  chatId: string,
  create: (groupId: string) => Promise<T>,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const groupId = chat?.groupId ?? store.groupIdFor(chatId);
    if (groupId === undefined) {
      return yield* Effect.fail(new Error('This group is not available yet.'));
    }
    const topic = yield* fromPromise(() => create(groupId));
    store.rememberTopic?.(topic);
    yield* store.apply(topic);
    const row = ctx.get().chats.find((entry) => entry.topic?.id === topic.id);
    if (row === undefined && store.requireRow) {
      return yield* Effect.fail(new Error('the new topic did not appear in the chat list'));
    }
    const rowId = row?.id ?? store.fallbackRowId(topic);
    yield* store.joinRoom(rowId);
    return rowId;
  });
}

/** The app half of `leaveTopic` (web re-checks a gone topic; mobile does not). */
export interface LeaveTopicStore<R = never> {
  /** The group id of a chat row, from the store's own remembered map. */
  groupIdFor(chatId: string): string | undefined;
  /** The signed-in user's id, or undefined before sign-in. */
  currentUserId(): string | undefined;
  /** Removes the caller through the app's remove-member action. */
  removeMember(chatId: string, userId: string): Effect.Effect<void, unknown, R>;
}

/** The 404 handling of a leave: whether it is one, and how to re-check the row. */
export interface LeaveTopicHooks<R = never> {
  /** True when the failure is the server's 404 (`ApiError.status === 404`). */
  isNotFound(error: unknown): boolean;
  /** Re-reads the topic's row and reports whether it left the list (web). */
  refreshTopicRow(chatId: string, topicId: string): Effect.Effect<boolean, unknown, R>;
  /** Re-reads the chat list after the topic really left (web). */
  refreshChats(): Effect.Effect<void, never, R>;
}

/**
 * Leaves a topic through the app's remove route. The last seat archives the
 * topic (the server answers 404 `Topic not found`): when the row is gone the
 * leave succeeds silently (web); any other failure is rethrown so the caller
 * shows its error.
 */
export function leaveTopic<R = never>(
  ctx: CoreCtx,
  store: LeaveTopicStore<R>,
  hooks: LeaveTopicHooks<R>,
  chatId: string,
): Effect.Effect<void, unknown, R> {
  return Effect.gen(function* () {
    const userId = store.currentUserId();
    if (userId === undefined) {
      return yield* Effect.fail(new Error('This topic is not available yet.'));
    }
    const removed = yield* Effect.exit(store.removeMember(chatId, userId));
    if (Exit.isSuccess(removed)) {
      return;
    }
    const error = Cause.squash(removed.cause);
    if (hooks.isNotFound(error)) {
      const { topicId } = yield* topicIdFor(ctx, store, chatId);
      const gone = yield* hooks.refreshTopicRow(chatId, topicId);
      if (gone) {
        yield* hooks.refreshChats();
        return;
      }
    }
    return yield* Effect.fail(error);
  });
}
