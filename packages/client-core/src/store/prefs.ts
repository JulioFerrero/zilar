// Per-chat preferences, shared by both stores: an optimistic write that rolls
// back on failure by re-merging the saved rows, so anything that landed while
// the PUT was in flight survives (R11, mobile's rule). Web and mobile keep
// their saved rows in different places, so a small `PrefsStore` adapter owns
// the read, the optimistic paint and the saved-row update.
import { Cause, Effect, Exit } from 'effect';
import type { ChatPrefRow } from '@zilar/chat-core';
import { fromPromise, type CoreCtx } from './ctx';

/** The write half of a chat-prefs client (both apps' clients satisfy it). */
export interface PrefsApi<P, R extends ChatPrefRow> {
  putChatPref(chatJid: string, input: P): Promise<R | null>;
}

/** Where one store keeps its saved rows and paints them into the chat list. */
export interface PrefsStore<P, R extends ChatPrefRow> {
  /** The saved rows, the server truth; never the optimistic paint. */
  savedRows(): readonly R[];
  setSavedRows(rows: readonly R[]): void;
  /** Paints rows into the chat list (and, on web, the pref map). */
  paint(rows: readonly R[]): void;
  /** The optimistic row for one patch, merged over the chat's saved row. */
  optimisticRow(chatJid: string, saved: readonly R[], patch: P, now: Date): R;
}

const sameChat = (row: ChatPrefRow, chatJid: string): boolean =>
  row.chatJid.toLowerCase() === chatJid.toLowerCase();

/** The rows with `chatJid`'s row replaced, or removed when `row` is null. */
export function withPrefRow<R extends ChatPrefRow>(
  rows: readonly R[],
  chatJid: string,
  row: R | null,
): R[] {
  const rest = rows.filter((entry) => !sameChat(entry, chatJid));
  return row === null ? rest : [...rest, row];
}

/**
 * Writes one pref patch: paints it at once, then settles on the server's row.
 * A failure re-paints the saved rows instead of the pre-write snapshot, so a
 * background update that landed mid-flight (R11) is kept and only the failed
 * change is dropped. Rejects with the original cause so the caller shows it.
 */
export function updatePref<P, R extends ChatPrefRow>(
  ctx: CoreCtx,
  api: PrefsApi<P, R>,
  store: PrefsStore<P, R>,
  chatId: string,
  patch: P,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    if (chat === undefined) {
      return yield* Effect.fail(new Error('This chat is not available yet.'));
    }
    const now = ctx.ports.now();
    const optimistic = store.optimisticRow(chatId, store.savedRows(), patch, now);
    store.paint(withPrefRow(store.savedRows(), chatId, optimistic));
    const saved = yield* Effect.exit(fromPromise(() => api.putChatPref(chatId, patch)));
    if (Exit.isFailure(saved)) {
      store.paint(store.savedRows());
      return yield* Effect.fail(Cause.squash(saved.cause));
    }
    const next = withPrefRow(store.savedRows(), chatId, saved.value);
    store.setSavedRows(next);
    store.paint(next);
  });
}
