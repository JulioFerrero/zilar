import { Effect } from 'effect';
import type { ChatPrefRow, ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatEntry } from '@zilar/api-contract';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { mergeChatRows } from './chat-rows';
import { fromPromise, nickFor, type CoreCtx, type CorePatch, type CoreState } from './ctx';
import { applyChatDelivery } from './delivered';
import type { LedgerBatchView } from './ledger-history-ingest';
import { applyChatReadMark, recordRead } from './reads';
import { coreKind, sortMessages } from './rows';

export const PREVIEW_HISTORY_MAX = 1;
export const PAGE_HISTORY_MAX = 50;
// Message search jumps at most this many history pages back looking for the
// hit before giving up with "Message not found".
export const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after this
// the jump gives up with "Message not found" instead of hanging.
export const MESSAGE_JUMP_WAIT_MS = 10_000;
const HISTORY_POLL_MS = 25;

export type HistoryLoad = 'loading' | 'ready' | 'error';

export interface HistoryState extends CoreState {
  readonly status: string;
  readonly historyState: Record<string, HistoryLoad>;
  readonly historyComplete: Record<string, boolean>;
  readonly openChat: (chatId: string) => void;
}

export interface HistoryPatch extends CorePatch {
  historyState?: Record<string, HistoryLoad>;
  historyComplete?: Record<string, boolean>;
}

export type HistorySet = (update: HistoryPatch | ((state: HistoryState) => HistoryPatch)) => void;

/**
 * Keeps the first copy of each message of one page: the server can archive a resend twice,
 * both rows carry one origin id and the ledger aliases them, so dropping the second is what
 * leaves one bubble.
 */
export const dedupePage = <T extends { readonly id: string }>(
  sameMessage: (left: string, right: string) => boolean,
  messages: readonly T[],
): T[] => {
  const kept: T[] = [];
  for (const message of messages) {
    if (!kept.some((item) => sameMessage(item.id, message.id))) {
      kept.push(message);
    }
  }
  return kept;
};

export interface HistoryCtx extends CoreCtx {
  readonly get: () => HistoryState;
  readonly set: HistorySet;
  /** Group history (MUC MAM) only works once the rooms are joined. */
  groupsJoined: boolean;
  /**
   * The group rooms joined so far: a chat's own history can load right after its room
   * joins, without waiting for every room.
   */
  joinedRooms?: Set<string>;
  pendingOpenChatId: string | undefined;
  readonly cursors: Record<string, string | undefined>;
  readonly loadingHistory: Set<string>;
  readonly loadingOlder: Set<string>;
}

export const setHistoryState = (ctx: HistoryCtx, chatId: string, state: HistoryLoad): void => {
  ctx.set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
};

/**
 * Drops the 'loading' marker of a pending chat superseded before it ever loaded, so no
 * ownerless entry stays behind. Settled entries and in-flight loads are left alone.
 */
export const clearSupersededMarker = (ctx: HistoryCtx, chatId: string): void => {
  if (ctx.loadingHistory.has(chatId)) {
    return;
  }
  ctx.set((previous) => {
    if (previous.historyState[chatId] !== 'loading') {
      return previous;
    }
    const next = { ...previous.historyState };
    delete next[chatId];
    return { historyState: next };
  });
};

export const canLoadHistory = (ctx: HistoryCtx, chat: ChatSummary): boolean =>
  ctx.core !== undefined &&
  ctx.get().status === 'online' &&
  (chat.kind !== 'group' ||
    ctx.groupsJoined ||
    ctx.joinedRooms?.has(chat.id) === true ||
    // The mobile history adapter rebuilds the context; the set rides on fx.
    ctx.fx.joinedRooms?.has(chat.id) === true);

// Resolves true once the in-flight first-page load for a chat settles, false after
// MESSAGE_JUMP_WAIT_MS so a stalled fetch cannot hang the jump.
export const waitForHistory = (ctx: HistoryCtx, chatId: string): Effect.Effect<boolean> => {
  const settled: Effect.Effect<boolean> = Effect.sleep(HISTORY_POLL_MS).pipe(
    Effect.andThen(
      Effect.suspend(() => (ctx.loadingHistory.has(chatId) ? settled : Effect.succeed(true))),
    ),
  );
  return settled.pipe(
    Effect.timeoutOrElse({
      duration: MESSAGE_JUMP_WAIT_MS,
      orElse: () => Effect.succeed(false),
    }),
  );
};

// The context a batch runs its read mark against: writes land in the page's one update.
const batchedCtx = (ctx: HistoryCtx, view: LedgerBatchView): CoreCtx => {
  const get = (): CoreState => ({ ...ctx.get(), ...view.get() });
  return {
    ...ctx,
    get,
    set: (update) => view.set(typeof update === 'function' ? update(get()) : update),
  };
};

/**
 * Maps a stanza to its bubble and aliases its MAM archive id to the row. A row's root
 * stays the root (the archive id joins it), so `wireTargetFor` and `correctionTargetFor`
 * keep naming the id the other person knows, never this user's private archive id.
 */
function linkArchiveId(
  k: HistoryCtx['k'],
  message: ChatMessage,
  currentUserId: string,
  page?: readonly ChatMessage[],
): UiMessage {
  const ui = k.toUiMessage(message, currentUserId, page);
  if (message.archiveId !== undefined) {
    k.linkMessageIds(ui.id, message.archiveId);
  }
  return ui;
}

/**
 * One backwards history page for `loadOlder` and `openAtMessage`: the page can overlap
 * what is loaded, and an already loaded message keeps its copy, so each one shows once.
 */
export const loadOlderPage = (
  ctx: HistoryCtx,
  chatId: string,
  cursor: string,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    if (chat === undefined || current === undefined || ctx.loadingOlder.has(chatId)) {
      return Effect.void;
    }
    ctx.loadingOlder.add(chatId);
    const { k } = ctx;
    return Effect.gen(function* () {
      const page = yield* fromPromise(() =>
        current.loadHistory(chatId, coreKind(chat), { before: cursor, max: PAGE_HISTORY_MAX }),
      );
      // The whole page lands in one store update: reactions, edits, merged messages, the
      // read mark and `historyComplete`.
      const patch = k.collectPage((view) => {
        k.ingestHistoryReactions(page.messages);
        k.ingestHistoryEdits(page.messages);
        const older = page.messages
          .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
          .map((message) => linkArchiveId(k, message, ctx.get().currentUserId, page.messages));
        k.resolvePendingEdits(chatId);
        const withEditsApplied = dedupePage(
          k.sameMessage,
          older.map((message) => k.withEdits(message, chatId)),
        );
        view.set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: k.mergeOlderPage(k.listFor(state, chatId), withEditsApplied),
          },
        }));
        k.refreshEdits(chatId);
        applyChatReadMark(batchedCtx(ctx, view), chatId);
      });
      ctx.set((state) => ({
        ...patch,
        historyComplete: { ...state.historyComplete, [chatId]: page.complete },
      }));
      ctx.cursors[chatId] = page.first;
    }).pipe(
      // A failed page load leaves the cursor for a later retry.
      Effect.catchCause(() => Effect.void),
      Effect.ensuring(Effect.sync(() => ctx.loadingOlder.delete(chatId))),
    );
  });

export const loadPreview = (
  ctx: HistoryCtx,
  current: XmppCore,
  chat: ChatSummary,
): Effect.Effect<void> => {
  const { k } = ctx;
  return Effect.gen(function* () {
    const page = yield* fromPromise(() =>
      current.loadHistory(chat.id, coreKind(chat), { max: PREVIEW_HISTORY_MAX }),
    );
    k.ingestHistoryReactions(page.messages);
    k.ingestHistoryEdits(page.messages);
    const last = page.messages
      .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
      .at(-1);
    if (last === undefined) {
      return;
    }
    const ui = linkArchiveId(k, last, ctx.get().currentUserId);
    k.resolvePendingEdits(chat.id);
    const preview = k.previewFor(k.withEdits(ui, chat.id));
    // One update for the list row and its history flag, so listeners are notified once.
    ctx.set((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.lastMessage === undefined
          ? { ...entry, lastMessage: preview }
          : entry,
      ),
      historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
    }));
    // The boot preview only fills the list row; it never marks read, so the first open of
    // a chat still shows its unread divider.
    ctx.cursors[chat.id] = page.first;
  }).pipe(
    // Preview is best-effort; the chat still works when opened.
    Effect.catchCause(() => Effect.void),
  );
};

export function mergeFreshChats(
  ctx: HistoryCtx,
  rows: readonly ChatSummary[],
  entries: ChatEntry[],
  prefs: readonly ChatPrefRow[],
  nowMs: number,
): ChatSummary[] {
  const previous = ctx.get().chats;
  for (const row of rows) applyChatDelivery(ctx, row);
  ctx.set({ chats: mergeChatRows(previous, rows, ctx.get().activeChatId, prefs, nowMs) });
  ctx.fx.rememberGroupIds?.(entries);
  return previous;
}

export const adoptNewRows = (
  ctx: HistoryCtx,
  core: XmppCore,
  me: { readonly name: string; readonly jid?: string | null | undefined },
  rows: readonly ChatSummary[],
  known: ReadonlyMap<string, ChatSummary>,
  onJoined: (row: ChatSummary) => void,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const fresh = rows.filter((row) => !known.has(row.id));
    for (const row of fresh.filter((item) => item.kind === 'group')) {
      yield* fromPromise(() => core.joinRoom(row.id, nickFor(me))).pipe(Effect.ignore);
      onJoined(row);
    }
    for (const row of fresh) {
      const chat = ctx.get().chats.find((item) => item.id === row.id);
      if (chat !== undefined) yield* loadPreview(ctx, core, chat);
    }
  });

export function flushPending(ctx: HistoryCtx): void {
  const pending = ctx.pendingOpenChatId;
  if (pending === undefined) {
    return;
  }
  const chat = ctx.get().chats.find((entry) => entry.id === pending);
  if (chat === undefined || !canLoadHistory(ctx, chat)) {
    return;
  }
  ctx.pendingOpenChatId = undefined;
  ctx.rt.fork(openHistory(ctx, pending));
}

export const openHistory = (ctx: HistoryCtx, chatId: string): Effect.Effect<void> =>
  Effect.suspend(() => {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    // `core` is assigned before `connect()` resolves, so "ready" means online: a MAM query
    // sent while still connecting fails.
    if (current === undefined || chat === undefined || !canLoadHistory(ctx, chat)) {
      // The chat screen mounted before the data was there (e.g. a reload of /c/<jid>).
      // Remember it and load once both are ready.
      ctx.pendingOpenChatId = chatId;
      setHistoryState(ctx, chatId, 'loading');
      return Effect.void;
    }
    if (ctx.loadingHistory.has(chatId)) {
      if (ctx.pendingOpenChatId === chatId) {
        ctx.pendingOpenChatId = undefined;
      }
      return Effect.void;
    }
    if (ctx.pendingOpenChatId === chatId) {
      ctx.pendingOpenChatId = undefined;
    }
    ctx.loadingHistory.add(chatId);
    setHistoryState(ctx, chatId, 'loading');
    const { k } = ctx;
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const page = yield* fromPromise(() =>
          current.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX }),
        );
        k.ingestHistoryReactions(page.messages);
        k.ingestHistoryEdits(page.messages);
        const loaded = page.messages
          .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
          .map((message) => linkArchiveId(k, message, ctx.get().currentUserId, page.messages));
        k.resolvePendingEdits(chatId);
        const withEditsApplied = dedupePage(
          k.sameMessage,
          loaded.map((message) => k.withEdits(message, chatId)),
        );
        const newest = withEditsApplied.at(-1);
        ctx.set((state) => {
          const live = k
            .listFor(state, chatId)
            .filter(
              (message) => !withEditsApplied.some((item) => k.sameMessage(item.id, message.id)),
            );
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...withEditsApplied, ...live]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
            chats:
              newest === undefined
                ? state.chats
                : state.chats.map((entry) =>
                    entry.id === chatId ? { ...entry, lastMessage: k.previewFor(newest) } : entry,
                  ),
          };
        });
        ctx.cursors[chatId] = page.first;
        k.refreshEdits(chatId);
        applyChatReadMark(ctx, chatId);
        // The displayed marker goes out only for a chat that is open, visible and focused:
        // a page that lands after leaving must not mark seen.
        if (ctx.get().activeChatId === chatId && ctx.ports.isVisible()) {
          const last = withEditsApplied.at(-1);
          if (last !== undefined) {
            recordRead(ctx, chatId, last.id);
            current.markDisplayed(chatId, coreKind(chat), last.id);
          }
        }
        setHistoryState(ctx, chatId, 'ready');
      }).pipe(
        // Keep whatever live messages we have; the view offers a retry. When the page fails
        // but live messages are on screen in the open, visible chat, still mark the newest seen.
        Effect.catchCause(() =>
          Effect.sync(() => {
            setHistoryState(ctx, chatId, 'error');
            if (ctx.get().activeChatId === chatId && ctx.ports.isVisible()) {
              const live = ctx.k.listFor(ctx.get(), chatId).at(-1);
              if (live !== undefined) {
                recordRead(ctx, chatId, live.id);
                current.markDisplayed(chatId, coreKind(chat), live.id);
              }
            }
          }),
        ),
        Effect.ensuring(Effect.sync(() => ctx.loadingHistory.delete(chatId))),
      );
      flushPending(ctx);
    });
  });

export function loadOlder(ctx: HistoryCtx, chatId: string): void {
  const cursor = ctx.cursors[chatId];
  if (cursor !== undefined) ctx.rt.fork(loadOlderPage(ctx, chatId, cursor));
}

export const openAtMessage = (
  ctx: HistoryCtx,
  chatId: string,
  messageId: string,
): Effect.Effect<UiMessage, Error> =>
  Effect.gen(function* () {
    const { k } = ctx;
    // An AI question card is re-keyed on the server to the message's archive id, which a
    // `messagesByChat` row never carries; only the chat preview reports it. Resolve the
    // requested id through the preview, then match the row by the ledger's aliases, and the
    // jump lands on the card instead of paging all the way up.
    const find = (): UiMessage | undefined => {
      const state = ctx.get();
      const preview = state.chats.find((entry) => entry.id === chatId)?.lastMessage;
      const wanted = preview?.archiveId === messageId ? preview.id : messageId;
      return k
        .listFor(state, chatId)
        .find((item) => k.sameMessage(item.id, wanted) || k.sameMessage(item.id, messageId));
    };
    ctx.get().openChat(chatId);
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    if (chat === undefined || current === undefined || !canLoadHistory(ctx, chat)) {
      const found = find();
      if (found === undefined) {
        return yield* Effect.fail(new Error('message_not_found'));
      }
      return found;
    }
    // Wait for the opening page when it is still in flight, then page
    // backwards until the message is loaded or history runs out. A stalled
    // wait (false) breaks out to "Message not found".
    for (let pages = 0; pages < MESSAGE_JUMP_MAX_PAGES; pages += 1) {
      const loaded = find();
      if (loaded !== undefined) {
        return loaded;
      }
      if (ctx.get().historyComplete[chatId] === true) {
        break;
      }
      if (ctx.loadingHistory.has(chatId)) {
        if (!(yield* waitForHistory(ctx, chatId))) {
          break;
        }
        continue;
      }
      const cursor = ctx.cursors[chatId];
      if (cursor === undefined) {
        if (!(yield* waitForHistory(ctx, chatId))) {
          break;
        }
        continue;
      }
      yield* loadOlderPage(ctx, chatId, cursor);
    }
    const found = find();
    if (found === undefined) {
      return yield* Effect.fail(new Error('message_not_found'));
    }
    return found;
  });
