// Group and topic actions shared by both stores: topic routes, leave, channel,
// group-detail and create/join/invite. Where the apps differ (web opens the new topic,
// mobile returns its id) a small adapter keeps each behaviour while the sequence lives here.
import { Cause, Effect, Exit } from 'effect';
import { fromPromise, type CoreCtx } from './ctx';
import { applyTopicRow, type TopicRowStore } from './groups';

export interface TopicRow {
  readonly id: string;
  readonly archived?: boolean | undefined;
}

export interface GroupActionStore {
  groupIdFor(chatId: string): string | undefined;
  rows: TopicRowStore;
}

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

export interface CreateTopicStore<T extends TopicRow> {
  groupIdFor(chatId: string): string | undefined;
  rememberTopic?(topic: T): void;
  apply(topic: T): Effect.Effect<void, unknown>;
  requireRow: boolean;
  fallbackRowId(topic: T): string;
  joinRoom(rowId: string): Effect.Effect<void, unknown>;
}

/** Creates a topic through the app's route, repaints its row, joins its room and answers
 * the row id. Web fails when the row is missing; mobile falls back to the response's JID. */
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
  groupIdFor(chatId: string): string | undefined;
  currentUserId(): string | undefined;
  removeMember(chatId: string, userId: string): Effect.Effect<void, unknown, R>;
}

export interface LeaveTopicHooks<R = never> {
  isNotFound(error: unknown): boolean;
  refreshTopicRow(chatId: string, topicId: string): Effect.Effect<boolean, unknown, R>;
  refreshChats(): Effect.Effect<void, never, R>;
}

/** Leaves a topic. The last seat archives it (the server answers 404): when the row is gone
 * the leave succeeds silently (web); any other failure is rethrown so the caller shows it. */
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

export interface LeaveChannelStore<R = never> {
  groupIdFor(chatId: string): string | undefined;
  currentUserId(): string | undefined;
  removeMember(groupId: string, userId: string): Effect.Effect<void, unknown, R>;
}

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

export interface GroupTarget {
  readonly groupId: string;
  readonly domain: string;
}

export interface ChangeGroupStore<D, R = never> {
  resolve(chatId: string): GroupTarget | undefined;
  applyDetail(chatId: string, detail: D, domain: string): void;
  reloadDetail?(groupId: string): Effect.Effect<void, unknown, R>;
  refreshList(): Effect.Effect<void, unknown, R>;
}

/** Runs a group route that repaints the detail: resolve the group, call the route, apply
 * the answer (or re-read it), then optionally refresh the list. */
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

export interface CreateGroupChannelStore<D, R = never> {
  create(): Promise<D>;
  /**
   * Repaints the chat list after the create and answers the new chat's JID
   * (web), or repaints quietly and answers undefined (mobile).
   */
  refreshAndLocate(detail: D): Effect.Effect<string | undefined, unknown, R>;
  open?(chatJid: string): Effect.Effect<void, unknown, R>;
  requireRow: boolean;
  result(chatJid: string | undefined, detail: D): string;
}

/** Creates a group or channel: call the app's route, repaint the list, open the chat and
 * answer its id. Web opens it and answers the JID; mobile answers the group id. */
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

export interface JoinPublicGroupStore<R = never> {
  join(groupId: string): Promise<unknown>;
  refreshList(): Effect.Effect<void, unknown, R>;
}

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

/** Creates a one-shot invite link and answers its URL. Web-only: mobile uses its invite
 * sheet's own client. */
export function createInvite(
  create: () => Promise<{ readonly url: string }>,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const invite = yield* fromPromise(() => create());
    return invite.url;
  });
}
