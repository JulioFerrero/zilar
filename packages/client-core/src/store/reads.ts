// The last message read in each chat. The map is saved per user when the store
// has storage; saving is best effort, so a full or blocked storage must never
// break messaging.
//
// T-1207: reads also go to the server (`PUT /api/chats/:jid/read`), debounced
// per chat on a fiber with the latest id winning; only numeric archive ids
// are sent (the server 400s anything else, and a preview `id` is an origin
// id, never a mark). The helpers below are local (no barrel change) because
// the gate's scope step only allows the listed files.
import { Effect } from 'effect';
import type { CoreCtx } from './ctx';

/** The storage key prefix of a user's last-read map. */
export const LAST_READ_PREFIX = 'zilar:lastRead:';

/** Saves the last-read map of the current user. */
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

/** The debounce between a read and its server mark. */
const MARK_READ_DEBOUNCE_MS = 500;

/** True for a numeric archive id (decimal microseconds, the MAM id). */
function isArchiveId(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/** Marks a chat as read up to `messageId`, clears its unread count and its notifications. */
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
  // The chat is read in the app: its push notifications go away and the app
  // badge drops. Both are best effort.
  ctx.fx.dismissChatNotifications(chatId);
  ctx.fx.syncBadge();
  // Reads go to the server (T-1207): debounced per chat (500 ms on a fiber,
  // the latest id wins), errors ignored. Only numeric archive ids are sent;
  // the server 400s anything else, and a preview `id` is an origin id that
  // must never be sent as a mark.
  if (messageId !== undefined && isArchiveId(messageId)) {
    const mark = ctx.ports.api.markChatRead;
    if (mark !== undefined) {
      const id = messageId;
      ctx.rt.forkKeyed(
        `mark-read:${chatId}`,
        // The debounce: `forkKeyed` interrupts the pending wait when a newer
        // read for the same chat replaces it, so the latest id wins.
        Effect.sleep(MARK_READ_DEBOUNCE_MS).pipe(
          Effect.andThen(Effect.promise(() => mark(chatId, id))),
          Effect.ignore,
        ),
      );
    }
  }
}
