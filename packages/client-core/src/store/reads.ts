// The last message read in each chat, saved per user when storage exists (best effort, so
// blocked storage never breaks messaging). Reads also go to the server, debounced per chat
// with the latest id winning; only numeric archive ids are sent, because a preview `id` is
// an origin id and the server 400s anything else.
import { Effect } from 'effect';
import type { CoreCtx } from './ctx';
import { applyStatusUntil } from './delivered';

export const LAST_READ_PREFIX = 'zilar:lastRead:';

export function persistLastRead(ctx: CoreCtx): void {
  const storage = ctx.ports.storage;
  const userId = ctx.lastReadUserId;
  if (storage === null || userId === undefined) {
    return;
  }
  Effect.runSync(
    Effect.try(() =>
      storage.setItem(`${LAST_READ_PREFIX}${userId}`, JSON.stringify(ctx.lastRead)),
    ).pipe(Effect.ignore),
  );
}

const MARK_READ_DEBOUNCE_MS = 500;

/** True for a numeric archive id (decimal microseconds, the MAM id). */
function isArchiveId(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

export function recordRead(ctx: CoreCtx, chatId: string, messageId: string | undefined): void {
  if (messageId !== undefined) {
    ctx.lastRead[chatId] = messageId;
    persistLastRead(ctx);
  }
  ctx.set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
    ),
  }));
  ctx.fx.dismissChatNotifications(chatId);
  ctx.fx.syncBadge();
  // Reads go to the server, debounced per chat (500 ms, latest id wins), errors ignored;
  // only numeric archive ids are sent, never a preview origin id.
  if (messageId !== undefined && isArchiveId(messageId)) {
    const mark = ctx.ports.api.markChatRead;
    if (mark !== undefined) {
      const id = messageId;
      ctx.rt.forkKeyed(
        `mark-read:${chatId}`,
        // The debounce: `forkKeyed` interrupts the pending wait when a newer read for the
        // same chat replaces it, so the latest id wins.
        Effect.sleep(MARK_READ_DEBOUNCE_MS).pipe(
          Effect.andThen(Effect.promise(() => mark(chatId, id))),
          Effect.ignore,
        ),
      );
    }
  }
}

/**
 * Applies the peer's read mark for one chat (`readUntil`), moving my own messages at or
 * below it to `read`; a later message keeps its status and a `read` one is not moved down.
 * A non-numeric mark is ignored.
 */
export function applyReadUntil(ctx: CoreCtx, chatId: string, until: string): void {
  applyStatusUntil(ctx, chatId, until, 'read');
}

export function applyChatReadMark(ctx: CoreCtx, chatId: string): void {
  const mark = ctx.get().chats.find((chat) => chat.id === chatId)?.readUntil;
  if (mark !== undefined) {
    applyReadUntil(ctx, chatId, mark);
  }
}
