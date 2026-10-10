// Group details and topic rows, shared by both stores (phase 2a): one
// `/api/groups/:id` GET per group id serves every topic row of that group
// (R14), and a topic row refreshed from the server drops an archived topic and
// re-applies the saved chat prefs (R17).
import { applyChatPrefs, type ChatPrefRow, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { fromPromise, type CoreCtx } from './ctx';
import { sortByRecency } from './rows';

/**
 * The group detail call both apps' clients satisfy. `D` is the app's detail
 * shape (the API contract's on web, the contract with a normalized member
 * `handle` on mobile), so the cache stays independent of one app's type.
 */
export interface GroupsApi<D> {
  getGroup(groupId: string): Promise<D>;
}

/**
 * Where one store keeps its group details and the loads in flight. The cache is
 * read through `cached`, keyed by group id, so a store whose own map is keyed
 * by chat id (web) scans it by `detail.id`.
 */
export interface GroupDetailStore<D> {
  /** The cached detail of a group, if one is already loaded. */
  cached(groupId: string): D | undefined;
  /** True while a detail load for the group is in flight. */
  isLoading(groupId: string): boolean;
  /** Marks the group's load in flight, so a second caller does not fetch. */
  begin(groupId: string): void;
  /** Clears the group's in-flight mark, however the load ended. */
  finish(groupId: string): void;
  /** Called once a detail lands, so the store repaints its per-chat view. */
  publish(groupId: string, detail: D): void;
}

/**
 * Loads a group detail once per group id: a cached detail returns without a
 * request, an in-flight load is not started twice, and `force` re-fetches an
 * already cached group (R14). A failed load is swallowed (both stores fall back
 * to the occupant nick), and the caller gets `undefined`.
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

/** The app half of a topic-row refresh: the chats page, its mapping and prefs. */
export interface TopicRowStore {
  /** Reads `/api/chats`. */
  getChats(): Promise<readonly unknown[]>;
  /** Maps one `/api/chats` entry to its chat rows (the app's `summariesFor`). */
  summariesFor(entry: unknown): ChatSummary[];
  /** Remembers the group id of every row of a fresh page. */
  rememberGroupIds(entries: readonly unknown[]): void;
  /** The saved pref rows a refreshed row re-merges (R17). */
  prefRows(): readonly ChatPrefRow[];
  /** The current time, for the pref merge. */
  now(): Date;
}

/**
 * Re-reads `/api/chats` and repaints one topic's row from the server (R17): an
 * archived topic drops its row (web's rule), and a live row keeps its local
 * last message, unread and presence while the saved prefs are re-applied
 * (mobile's rule).
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
      // An archived topic is gone for everyone: the server excludes it from
      // the list, so drop the row at once instead of waiting for the next
      // poll. The open view follows via the removed-while-open flow.
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
