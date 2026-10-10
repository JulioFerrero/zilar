// Group and topic actions shared by both stores: the topic routes (create,
// patch, AI and member changes, roles) and the leave flow from phase 2b, and
// the channel, group-detail and create/join/invite actions from phase 2c
// (T-0923). Where the two apps differ (web opens the new topic, mobile returns
// its group id; web re-checks a gone topic, mobile does not) a small app
// adapter keeps each app's behaviour while the sequence and the repaint live
// in one place.
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

/** The app half of `leaveChannel`: how to resolve the group and remove the caller. */
export interface LeaveChannelStore<R = never> {
  /** The group id of a chat row, from the store's own remembered map. */
  groupIdFor(chatId: string): string | undefined;
  /** The signed-in user's id, or undefined before sign-in. */
  currentUserId(): string | undefined;
  /** Removes the caller through the app's remove-member action. */
  removeMember(groupId: string, userId: string): Effect.Effect<void, unknown, R>;
}

/**
 * Leaves a channel through the app's member route: resolve the group and the
 * caller, remove them, then refresh the chat list with the app's own rules.
 */
export function leaveChannel<R = never>(
  store: LeaveChannelStore<R>,
  refreshList: Effect.Effect<void, unknown, R>,
  chatId: string,
): Effect.Effect<void, unknown, R> {
  return Effect.gen(function* () {
    const groupId = store.groupIdFor(chatId);
    const userId = store.currentUserId();
    if (groupId === undefined || userId === undefined) {
      return yield* Effect.fail(new Error('This channel is not available yet.'));
    }
    yield* store.removeMember(groupId, userId);
    yield* refreshList;
  });
}

/** The group of one chat and the domain its member jids use. */
export interface GroupTarget {
  readonly groupId: string;
  readonly domain: string;
}

/** The app half of `changeGroup`. */
export interface ChangeGroupStore<D, R = never> {
  /** The group of a chat and the domain member jids use, or undefined. */
  resolve(chatId: string): GroupTarget | undefined;
  /** Repaints a group's detail from the server's answer. */
  applyDetail(chatId: string, detail: D, domain: string): void;
  /** Re-reads the group detail when the route answers nothing (mobile). */
  reloadDetail?(groupId: string): Effect.Effect<void, unknown, R>;
  /** Re-reads the chat list with the app's own rules. */
  refreshList(): Effect.Effect<void, unknown, R>;
}

/**
 * Runs a group route that repaints the group's detail: resolve the group, call
 * the route, apply the answer (or re-read the detail), then optionally refresh
 * the list. Web's settings and channel role, mobile's channel role.
 */
export function changeGroup<D, R = never>(
  store: ChangeGroupStore<D, R>,
  chatId: string,
  notAvailable: string,
  call: (groupId: string) => Promise<D>,
  refresh: boolean,
): Effect.Effect<void, unknown, R> {
  return Effect.gen(function* () {
    const target = store.resolve(chatId);
    if (target === undefined) {
      return yield* Effect.fail(new Error(notAvailable));
    }
    const detail = yield* fromPromise(() => call(target.groupId));
    store.applyDetail(chatId, detail, target.domain);
    if (store.reloadDetail !== undefined) {
      yield* store.reloadDetail(target.groupId);
    }
    if (refresh) {
      yield* store.refreshList();
    }
  });
}

/** The app half of `createGroupChannel`. */
export interface CreateGroupChannelStore<D, R = never> {
  /** Calls the app's create route with the app's own input rules. */
  create(): Promise<D>;
  /**
   * Repaints the chat list after the create and answers the new chat's JID
   * (web), or repaints quietly and answers undefined (mobile).
   */
  refreshAndLocate(detail: D): Effect.Effect<string | undefined, unknown, R>;
  /** Joins the new chat's room and opens it (web); mobile has none. */
  open?(chatJid: string): Effect.Effect<void, unknown, R>;
  /** True to fail when the new row is missing from the list (web). */
  requireRow: boolean;
  /** The answer: the new chat JID (web) or the group id (mobile). */
  result(chatJid: string | undefined, detail: D): string;
}

/**
 * Creates a group or a channel: call the app's route, repaint the list, open
 * the new chat and answer its id. Web opens the chat and answers its JID,
 * mobile answers the group id and opens nothing (R15).
 */
export function createGroupChannel<D, R = never>(
  store: CreateGroupChannelStore<D, R>,
  notFound: string,
): Effect.Effect<string, unknown, R> {
  return Effect.gen(function* () {
    const detail = yield* fromPromise(() => store.create());
    const chatJid = yield* store.refreshAndLocate(detail);
    if (chatJid === undefined && store.requireRow) {
      return yield* Effect.fail(new Error(notFound));
    }
    if (chatJid !== undefined && store.open !== undefined) {
      yield* store.open(chatJid);
    }
    return store.result(chatJid, detail);
  });
}

/** The app half of `joinPublicGroup`. */
export interface JoinPublicGroupStore<R = never> {
  /** Joins the public group through the app's route. */
  join(groupId: string): Promise<unknown>;
  /** Re-reads the chat list with the app's own rules. */
  refreshList(): Effect.Effect<void, unknown, R>;
}

/**
 * Joins a public group, refreshes the list and answers the General chat id
 * (undefined while the list has not caught up). Web-only today.
 */
export function joinPublicGroup<R = never>(
  ctx: CoreCtx,
  store: JoinPublicGroupStore<R>,
  groupId: string,
): Effect.Effect<string | undefined, unknown, R> {
  return Effect.gen(function* () {
    yield* fromPromise(() => store.join(groupId));
    yield* store.refreshList();
    return ctx
      .get()
      .chats.find((entry) => entry.groupId === groupId && entry.topic?.isGeneral !== false)?.id;
  });
}

/**
 * Creates a one-shot invite link and answers its URL. Web-only today: mobile
 * creates its invites from the invite sheet's own client.
 */
export function createInvite(
  create: () => Promise<{ readonly url: string }>,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const invite = yield* fromPromise(() => create());
    return invite.url;
  });
}
