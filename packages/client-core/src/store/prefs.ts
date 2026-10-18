// Per-chat preferences shared by both stores: an optimistic write that rolls back by
// re-merging the saved rows, so anything that landed mid-flight survives; a small adapter
// owns the per-store read and paint.
import { Cause, Effect, Exit } from 'effect';
import type { ChatPrefRow } from '@zilar/chat-core';
import { fromPromise, type CoreCtx } from './ctx';

export interface PrefsApi<P, R extends ChatPrefRow> {
  putChatPref(chatJid: string, input: P): Promise<R | null>;
}

export type PrefPatch = {
  [K in 'mutedUntil' | 'archived' | 'unreadMark']?: ChatPrefRow[K] | undefined;
} & { pinned?: boolean | undefined };
export type OptimisticPrefRow = ChatPrefRow & { updatedAt: string };

export interface PrefsStore<P, R extends ChatPrefRow> {
  savedRows(): readonly R[];
  setSavedRows(rows: readonly R[]): void;
  paint(rows: readonly R[]): void;
  optimisticRow(chatJid: string, saved: readonly R[], patch: P, now: Date): R;
}

const sameChat = (row: ChatPrefRow, chatJid: string): boolean =>
  row.chatJid.toLowerCase() === chatJid.toLowerCase();

export function withPrefRow<R extends ChatPrefRow>(
  rows: readonly R[],
  chatJid: string,
  row: R | null,
): R[] {
  const rest = rows.filter((entry) => !sameChat(entry, chatJid));
  return row === null ? rest : [...rest, row];
}

// Merges a partial patch over the saved row so kept fields never flash off; extend adds extras.
export function optimisticPrefRow<R extends ChatPrefRow>(
  chatJid: string,
  saved: readonly R[],
  patch: PrefPatch,
  now: Date,
  extend?: (row: OptimisticPrefRow, previous: R | undefined) => OptimisticPrefRow,
): OptimisticPrefRow {
  const previous = saved.find((row) => sameChat(row, chatJid));
  const row: OptimisticPrefRow = {
    chatJid,
    mutedUntil: patch.mutedUntil !== undefined ? patch.mutedUntil : (previous?.mutedUntil ?? null),
    archived: patch.archived !== undefined ? patch.archived : (previous?.archived ?? false),
    pinnedAt:
      patch.pinned === false
        ? null
        : (previous?.pinnedAt ?? (patch.pinned ? now.toISOString() : null)),
    unreadMark: patch.unreadMark !== undefined ? patch.unreadMark : (previous?.unreadMark ?? false),
    updatedAt: now.toISOString(),
  };
  return extend === undefined ? row : extend(row, previous);
}

/**
 * Writes one pref patch: paints it at once, then settles on the server's row. A failure
 * re-paints the saved rows instead of a pre-write snapshot, so a background update that
 * landed mid-flight is kept; rejects with the original cause.
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
