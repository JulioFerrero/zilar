// Group details and topic rows shared by both stores: one `/api/groups/:id` GET serves
// every topic row of that group, and a refreshed row drops an archived topic and re-applies
// the saved chat prefs.
import { applyChatPrefs, type ChatPrefRow, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { fromPromise, type CoreCtx } from './ctx';
import { sortByRecency } from './rows';

export interface GroupsApi<D> {
  getGroup(groupId: string): Promise<D>;
}

/**
 * Where one store keeps its group details and the loads in flight. `cached` is keyed by
 * group id, so a store whose own map is keyed by chat id scans it by `detail.id`.
 */
export interface GroupDetailStore<D> {
  cached(groupId: string): D | undefined;
  isLoading(groupId: string): boolean;
  begin(groupId: string): void;
  finish(groupId: string): void;
  publish(groupId: string, detail: D): void;
}

/**
 * Loads a group detail once per id: a cached one returns without a request, an in-flight
 * one is not started twice, and `force` re-fetches. A failed load is swallowed (both stores
 * fall back to the occupant nick).
 */
export function ensureGroupDetail<D>(
  api: GroupsApi<D>,
  store: GroupDetailStore<D>,
  groupId: string,
  force = false,
): Effect.Effect<D | undefined, never> {
  return Effect.suspend(() => {
    if (groupId === '') {
      return Effect.succeed(undefined);
    }
    if (store.isLoading(groupId)) {
      return Effect.succeed(store.cached(groupId));
    }
    if (!force) {
      const cached = store.cached(groupId);
      if (cached !== undefined) {
        return Effect.succeed(cached);
      }
    }
    store.begin(groupId);
    return fromPromise(() => api.getGroup(groupId)).pipe(
      Effect.tap((detail) => Effect.sync(() => store.publish(groupId, detail))),
      Effect.catchCause(() => Effect.succeed<D | undefined>(undefined)),
      Effect.ensuring(Effect.sync(() => store.finish(groupId))),
    );
  });
}

export interface TopicRowStore {
  getChats(): Promise<readonly unknown[]>;
  summariesFor(entry: unknown): ChatSummary[];
  rememberGroupIds(entries: readonly unknown[]): void;
  prefRows(): readonly ChatPrefRow[];
  now(): Date;
}

/**
 * Re-reads `/api/chats` and repaints one topic's row: an archived topic drops its row,
 * while a live row keeps its local last message, unread and presence and the saved prefs
 * are re-applied.
 */
export function applyTopicRow(
  ctx: CoreCtx,
  store: TopicRowStore,
  topic: { readonly id: string; readonly archived?: boolean | undefined },
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const entries = yield* fromPromise(() => store.getChats());
    store.rememberGroupIds(entries);
    const rows = entries.flatMap((entry) => store.summariesFor(entry));
    const match = rows.find((row) => row.topic?.id === topic.id);
    ctx.set((state) => {
      // An archived topic is gone for everyone: drop the row at once instead of waiting
      // for the next poll; the open view follows via the removed-while-open flow.
      if (match === undefined || topic.archived === true) {
        const filtered = state.chats.filter((chat) => chat.topic?.id !== topic.id);
        return filtered.length === state.chats.length ? state : { chats: filtered };
      }
      const applied = applyChatPrefs([match], store.prefRows(), store.now().getTime())[0] ?? match;
      const before = state.chats.find((chat) => chat.id === applied.id);
      const merged: ChatSummary =
        before === undefined
          ? applied
          : {
              ...applied,
              ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
              unread: before.unread,
              ...(before.online === undefined ? {} : { online: before.online }),
              ...(before.onlineCount === undefined ? {} : { onlineCount: before.onlineCount }),
            };
      return {
        chats: state.chats.some((chat) => chat.id === merged.id)
          ? state.chats.map((chat) => (chat.id === merged.id ? merged : chat))
          : sortByRecency([...state.chats, merged]),
      };
    });
  });
}
