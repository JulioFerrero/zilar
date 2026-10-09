import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';

import type { ChatEntry } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
import { TOPIC_GONE_NOTICE } from '../../lib/topics';
import { Ports } from './ports';
import { detached, isClosed, lift, orElse, recover, type StoreCtx } from './runtime';

const PREVIEW_HISTORY_MAX = 1;
const PAGE_HISTORY_MAX = 50;

// A search jump loads at most this many history pages back looking for the
// hit before giving up with "Message not found" (web uses the same cap).
export const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after
// this the jump gives up with "Message not found" instead of hanging.
export const MESSAGE_JUMP_WAIT_MS = 10_000;

export interface History {
  /** The prefs rows: server truth when injected, empty otherwise. */
  readonly loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  /** The user's chat folders (T-0248); a failed load keeps the last list. */
  readonly loadFolders: Effect.Effect<void, never, Ports>;
  /** The periodic and foreground refresh; failures are silent. */
  readonly refreshChats: Effect.Effect<void, never, Ports>;
  loadPreview(current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports>;
  /** Runs the pending open once the core is online and the chat is known. */
  flushPending(): void;
  openChat(chatId: string): void;
  reloadChats(): void;
  retryHistory(chatId: string): void;
  loadOlder(chatId: string): void;
  openAtMessage(chatId: string, messageId: string): Promise<UiMessage>;
}

/**
 * First-page history, older pages, previews, the chat list refresh and
 * `openChat`. Every load is a fiber of the session, so `stop()` interrupts
 * it; the chat list refresh also ends with its generation.
 */
export function makeHistory(ctx: StoreCtx): History {
  const { ports, get, set, s, life, h, fx } = ctx;
  const { cursors, loadingHistory, loadingOlder, groupIds } = s;

  const loadPrefRows: Effect.Effect<ChatPref[], never, Ports> = Effect.gen(function* () {
    const { chatPrefs } = yield* Ports;
    if (chatPrefs === undefined) {
      return [];
    }
    return yield* recover(
      lift(() => chatPrefs.listChatPrefs()),
      () => Effect.sync((): ChatPref[] => s.chatPrefRows),
    );
  });

  const loadFolders: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const { chatFolders } = yield* Ports;
    if (chatFolders === undefined) {
      return;
    }
    // Keep the last list on a failure; a retry happens on the next refresh.
    yield* orElse(
      lift(() => chatFolders.listChatFolders()).pipe(
        Effect.flatMap((folders) => Effect.sync(() => get().setFolders(folders))),
      ),
      undefined,
    );
  });

  // Merges a fresh chat list, preserving the local last message, unread
  // count, mute flag and presence of the chats already shown. Topic entries
  // (T-0112) expand to one row per visible topic; rows that disappeared
  // (made private, archived, or I was removed) vanish here, and the open
  // topic moves to the topics screen with a short, name-free notice.
  // Chat prefs (T-0135) are applied after the merge so server rows pin,
  // mute and archive the summaries; a pref whose chat is gone is ignored.
  // Returns the previous chats so the caller can tell which rows are new.
  function mergeChatEntries(entries: ChatEntry[]): Map<string, ChatSummary> {
    const previous = get().chats;
    const known = new Map(previous.map((chat) => [chat.id, chat]));
    const rows = entries.flatMap((entry) => h.summariesFor(entry));
    const wanted = new Set(rows.map((row) => row.id));
    const fresh = rows.filter((row) => !known.has(row.id));
    const kept = rows
      .filter((row) => known.has(row.id))
      .map((row) => {
        const existing = known.get(row.id);
        if (existing === undefined) {
          return row;
        }
        return {
          ...row,
          ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
          unread: existing.unread,
          ...(existing.online === undefined ? {} : { online: existing.online }),
          ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
        };
      });
    // New chats appear at the top; the rest keep their recency order.
    const merged = applyChatPrefs(
      [...fresh, ...h.sortByRecency(kept)],
      s.chatPrefRows,
      ports.now().getTime(),
    );
    set({ chats: merged });
    h.rememberGroupIds(entries);
    // A topic that disappeared while open navigates back to its group's
    // topics screen with a short notice that never names the topic.
    const openId = get().activeChatId;
    if (openId !== null && !wanted.has(openId)) {
      const was = previous.find((chat) => chat.id === openId);
      if (was?.topic !== undefined && was.groupId !== undefined) {
        set({
          activeChatId: null,
          topicNotice: { groupId: was.groupId, message: TOPIC_GONE_NOTICE },
        });
      } else {
        set({ activeChatId: null });
      }
    }
    return known;
  }

  const loadPreview = (current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports> =>
    // Preview is best-effort; the chat still works when opened.
    orElse(
      Effect.gen(function* () {
        const page = yield* lift(() =>
          current.loadHistory(chat.id, h.coreKind(chat), { max: PREVIEW_HISTORY_MAX }),
        );
        // Edits and reactions update derived state and never render as a
        // bubble or preview row.
        h.ingestHistoryReactions(page.messages);
        h.ingestHistoryEdits(page.messages);
        const last = page.messages
          .filter((message) => !h.isReactionOnly(message) && !h.isEditStanza(message))
          .at(-1);
        if (last === undefined) {
          return;
        }
        const ui = h.toUiMessage(last, get().currentUserId);
        h.resolvePendingEdits(chat.id);
        const preview = h.previewFor(h.withEdits(ui, chat.id));
        set((state) => ({
          chats: state.chats.map((entry) =>
            entry.id === chat.id && entry.lastMessage === undefined
              ? { ...entry, lastMessage: preview }
              : entry,
          ),
        }));
        if (s.lastRead[chat.id] === undefined) {
          s.lastRead[chat.id] = ui.id;
        }
        cursors[chat.id] = page.first;
        set((state) => ({
          historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
        }));
      }),
      undefined,
    );

  // Joins the rooms of the new groups and loads their preview, best-effort.
  // Topic rows (T-0112) each join their own room, like group rows today.
  const adoptChatEntries = (
    entries: ChatEntry[],
    known: Map<string, ChatSummary>,
  ): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const current = s.core;
      const me = get().me;
      if (current === undefined || me === undefined) {
        return;
      }
      // Dedupe the roster path per group id (T-0147): every topic row of one
      // group joins its own room, but the member names come from one shared
      // detail GET per group, not one per row.
      const detailStarted = new Set<string>();
      const freshRows = entries
        .flatMap((entry) => h.summariesFor(entry))
        .filter((row) => !known.has(row.id) && row.kind === 'group');
      for (const row of freshRows) {
        yield* orElse(
          lift(() => current.joinRoom(row.id, h.nick(me))),
          undefined,
        );
        const groupId = row.groupId ?? groupIds.get(row.id);
        if (groupId !== undefined && !detailStarted.has(groupId)) {
          detailStarted.add(groupId);
          ctx.forkSession(fx.ensureGroupDetail(groupId));
        }
        ctx.forkSession(fx.ensureGroupMembers(row.id));
      }
      for (const row of entries.flatMap((entry) => h.summariesFor(entry))) {
        if (known.has(row.id)) {
          continue;
        }
        const chat = get().chats.find((item) => item.id === row.id);
        if (chat !== undefined) {
          yield* loadPreview(current, chat);
        }
      }
    });

  // The chats, prefs and folders load together; prefs and folders never fail,
  // and a failing chat list does not cancel them.
  const fetchChatList = Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* Effect.all(
      [lift(() => api.getChats()), detached(loadPrefRows), detached(loadFolders)],
      { concurrency: 'unbounded' },
    ).pipe(Effect.option);
  });

  // A background refresh failure stays silent; the manual reload reports it.
  // The generation is checked after the fetch: a refresh run by an action,
  // outside the generation's fibers, must not land after a stop.
  const refreshChats: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const generation = life.generation();
    const fetched = yield* fetchChatList;
    if (fetched._tag === 'None' || isClosed(generation)) {
      return;
    }
    const [entries, prefs] = fetched.value;
    s.chatPrefRows = prefs;
    const known = mergeChatEntries(entries);
    h.flushPending();
    yield* adoptChatEntries(entries, known);
  });

  // Pull-to-refresh and the list's Retry key. Unlike a background refresh it
  // reports a failure in `chatsLoad`, and it only re-runs boot when the first
  // boot never got as far as a core (e.g. the first `/api/chats` failed).
  const reloadChatsList: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const generation = life.generation();
    const fetched = yield* fetchChatList;
    if (fetched._tag === 'None') {
      if (!isClosed(generation)) {
        set({ chatsLoad: 'error' });
      }
      return;
    }
    if (isClosed(generation)) {
      return;
    }
    const [entries, prefs] = fetched.value;
    s.chatPrefRows = prefs;
    const known = mergeChatEntries(entries);
    set({ chatsLoad: 'loaded' });
    h.flushPending();
    yield* adoptChatEntries(entries, known);
  });

  // A history load is safe only once the core is online (it is assigned
  // before `connect()` resolves, so presence alone is not enough: a MAM query
  // sent while still connecting fails) and, for a group, once its room joined.
  function canLoadHistory(chat: ChatSummary): boolean {
    return (
      s.core !== undefined && get().status === 'online' && (chat.kind !== 'group' || s.groupsJoined)
    );
  }

  // Runs the pending open once the core is online and the chat is known.
  // Called after every point where either can become ready: the first chat
  // merge, a background refresh, a manual reload and (re)connect.
  function flushPending(): void {
    const pending = s.pendingOpenChatId;
    if (pending === undefined) {
      return;
    }
    const chat = get().chats.find((entry) => entry.id === pending);
    if (chat === undefined || !canLoadHistory(chat)) {
      return;
    }
    s.pendingOpenChatId = undefined;
    ctx.forkSession(openHistory(pending));
  }

  const openHistory = (chatId: string): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = s.core;
      if (current === undefined || chat === undefined || !canLoadHistory(chat)) {
        // The chat screen mounted before the data was there. Remember it and
        // load once the core and the chat are both ready; never query MAM while
        // the core is still connecting.
        s.pendingOpenChatId = chatId;
        h.setHistoryLoad(chatId, 'loading');
        return;
      }
      if (loadingHistory.has(chatId)) {
        // A load for this chat is already in flight; it covers this open.
        if (s.pendingOpenChatId === chatId) {
          s.pendingOpenChatId = undefined;
        }
        return;
      }
      if (s.pendingOpenChatId === chatId) {
        s.pendingOpenChatId = undefined;
      }
      loadingHistory.add(chatId);
      h.setHistoryLoad(chatId, 'loading');
      yield* recover(
        Effect.gen(function* () {
          const page = yield* lift(() =>
            current.loadHistory(chatId, h.coreKind(chat), { max: PAGE_HISTORY_MAX }),
          );
          // Edits and reactions update derived state and never render as a
          // bubble or preview row.
          h.ingestHistoryReactions(page.messages);
          h.ingestHistoryEdits(page.messages);
          const loaded = page.messages
            .filter((message) => !h.isReactionOnly(message) && !h.isEditStanza(message))
            .map((message) => h.toUiMessage(message, get().currentUserId));
          h.resolvePendingEdits(chatId);
          const withEditsApplied = loaded.map((message) => h.withEdits(message, chatId));
          const newest = withEditsApplied.at(-1);
          set((state) => {
            const live = h
              .listFor(state, chatId)
              .filter(
                (message) => !withEditsApplied.some((item) => h.sameMessage(item.id, message.id)),
              );
            return {
              messagesByChat: {
                ...state.messagesByChat,
                [chatId]: h.sortMessages([...withEditsApplied, ...live]),
              },
              historyComplete: { ...state.historyComplete, [chatId]: page.complete },
              chats:
                newest === undefined
                  ? state.chats
                  : state.chats.map((entry) =>
                      entry.id === chatId ? { ...entry, lastMessage: h.previewFor(newest) } : entry,
                    ),
            };
          });
          cursors[chatId] = page.first;
          h.refreshEdits(chatId);
          const last = withEditsApplied.at(-1);
          if (last !== undefined) {
            h.recordRead(chatId, last.id);
            current.markDisplayed(chatId, h.coreKind(chat), last.id);
          }
          h.setHistoryLoad(chatId, 'loaded');
        }),
        // Keep whatever live messages we have; the view offers a retry.
        () => Effect.sync(() => h.setHistoryLoad(chatId, 'error')),
      ).pipe(Effect.ensuring(Effect.sync(() => loadingHistory.delete(chatId))));
      h.flushPending();
    });

  // One backwards history page, shared by `loadOlder` and `openAtMessage`.
  const loadOlderPage = (chatId: string, cursor: string): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = s.core;
      if (chat === undefined || current === undefined || loadingOlder.has(chatId)) {
        return;
      }
      loadingOlder.add(chatId);
      // A failed page load leaves the cursor for a later retry.
      yield* orElse(
        Effect.gen(function* () {
          const page = yield* lift(() =>
            current.loadHistory(chatId, h.coreKind(chat), {
              before: cursor,
              max: PAGE_HISTORY_MAX,
            }),
          );
          // Edits and reactions update derived state and never render as a
          // bubble or preview row.
          h.ingestHistoryReactions(page.messages);
          h.ingestHistoryEdits(page.messages);
          const older = page.messages
            .filter((message) => !h.isReactionOnly(message) && !h.isEditStanza(message))
            .map((message) => h.toUiMessage(message, get().currentUserId));
          h.resolvePendingEdits(chatId);
          const withEditsApplied = older.map((message) => h.withEdits(message, chatId));
          set((state) => ({
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: h.sortMessages([...withEditsApplied, ...h.listFor(state, chatId)]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
          }));
          cursors[chatId] = page.first;
          h.refreshEdits(chatId);
        }),
        undefined,
      ).pipe(Effect.ensuring(Effect.sync(() => loadingOlder.delete(chatId))));
    });

  function loadOlder(chatId: string): void {
    const cursor = cursors[chatId];
    if (cursor === undefined) {
      return;
    }
    ctx.forkSession(loadOlderPage(chatId, cursor));
  }

  // Resolves true once the in-flight first-page load for a chat settles,
  // so a search jump never pages past a page that is still arriving.
  const waitForHistory = (chatId: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (!loadingHistory.has(chatId)) {
        return true;
      }
      return yield* Effect.repeat(Effect.sleep(25), {
        while: () => loadingHistory.has(chatId),
      }).pipe(
        Effect.as(true),
        Effect.timeoutOrElse({
          duration: MESSAGE_JUMP_WAIT_MS,
          orElse: () => Effect.succeed(false),
        }),
      );
    });

  const openAtMessage = (
    chatId: string,
    messageId: string,
  ): Effect.Effect<UiMessage, Error, Ports> =>
    Effect.gen(function* () {
      get().openChat(chatId);
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = s.core;
      if (chat === undefined || current === undefined || !canLoadHistory(chat)) {
        const found = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
        if (found === undefined) {
          return yield* Effect.fail(new Error('message_not_found'));
        }
        set({ jumpTarget: { chatId, messageId } });
        return found;
      }
      // Wait for the opening page when it is still in flight, then page
      // backwards until the message is loaded or history runs out. A
      // stalled wait (false) breaks out to "Message not found".
      for (let pages = 0; pages < MESSAGE_JUMP_MAX_PAGES; pages += 1) {
        const loaded = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
        if (loaded !== undefined) {
          set({ jumpTarget: { chatId, messageId } });
          return loaded;
        }
        if (get().historyComplete[chatId] === true) {
          break;
        }
        if (loadingHistory.has(chatId)) {
          if (!(yield* waitForHistory(chatId))) {
            break;
          }
          continue;
        }
        const cursor = cursors[chatId];
        if (cursor === undefined) {
          if (!(yield* waitForHistory(chatId))) {
            break;
          }
          continue;
        }
        yield* loadOlderPage(chatId, cursor);
      }
      const found = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      if (found === undefined) {
        return yield* Effect.fail(new Error('message_not_found'));
      }
      set({ jumpTarget: { chatId, messageId } });
      return found;
    });

  return {
    loadPrefRows,
    loadFolders,
    refreshChats,
    loadPreview,
    flushPending,
    loadOlder,
    openAtMessage: (chatId, messageId) => ctx.run(openAtMessage(chatId, messageId)),
    retryHistory: (chatId) => {
      ctx.forkSession(openHistory(chatId));
    },
    reloadChats: () => {
      set({ chatsLoad: 'loading' });
      // A first boot that never reached a core (e.g. `/api/chats` failed) is
      // retried whole; a running session just refetches the list.
      if (s.core === undefined) {
        fx.restartBoot();
        return;
      }
      ctx.fork(reloadChatsList);
    },
    openChat: (chatId) => {
      set((state) => {
        const chat = state.chats.find((entry) => entry.id === chatId);
        const noticeGroup = state.topicNotice?.groupId;
        const keepNotice =
          noticeGroup !== undefined && chat?.groupId !== undefined && chat.groupId === noticeGroup;
        return {
          activeChatId: chatId,
          topicNotice: keepNotice ? state.topicNotice : undefined,
        };
      });
      h.recordRead(chatId, s.lastRead[chatId]);
      // The detail first: it fills the cache, so the member-name fallback
      // shares the same GET on a cold open (T-0147 ordering).
      const groupId = h.groupIdForChat(chatId);
      if (groupId !== undefined) {
        ctx.forkSession(fx.ensureGroupDetail(groupId));
      }
      ctx.forkSession(fx.ensureGroupMembers(chatId));
      // Pins load when the chat opens and refresh on focus + 60 s while
      // it is open, like the web store (no realtime channel yet).
      ctx.forkSession(fx.loadPins(chatId, true));
      fx.startPinsPolling(chatId);
      if (s.pendingOpenChatId !== undefined && s.pendingOpenChatId !== chatId) {
        h.clearSupersededMarker(s.pendingOpenChatId);
      }
      s.pendingOpenChatId = chatId;
      ctx.forkSession(openHistory(chatId));
    },
  };
}
