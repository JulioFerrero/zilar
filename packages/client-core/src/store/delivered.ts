// The delivered tick, client side (T-1238). A connected device confirms the
// messages it holds over HTTP (`PUT /api/chats/:jid/delivered`), and the
// sender's app applies the mark `/api/chats` reports. Delivery is named by the
// origin id (the wire id, `docs/plan/delivered-tick.md` §4); the server keeps
// the max and ignores the caller's own messages, so confirming a preview is
// always safe. The queue lives beside the state (keyed by the store context),
// like the typing slots: the core context itself never carries it.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { CoreCtx } from './ctx';
import { advanceStatus } from './rows';

/** The debounce between a chat's confirmations and its one HTTP call. */
export const MARK_DELIVERED_DEBOUNCE_MS = 1_000;
/** One confirmation call carries at most this many ids (the server's cap). */
export const MARK_DELIVERED_MAX = 50;

/** Origin ids queued per chat, per store context. */
const pendingDelivered = new WeakMap<CoreCtx, Map<string, string[]>>();

function queueOf(ctx: CoreCtx): Map<string, string[]> {
  let queues = pendingDelivered.get(ctx);
  if (queues === undefined) {
    queues = new Map();
    pendingDelivered.set(ctx, queues);
  }
  return queues;
}

/** True for a numeric archive id (decimal microseconds, the MAM id). */
function isArchiveId(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/**
 * Compares two decimal archive ids as strings: length first, then
 * lexicographically. Never `BigInt` (the T-1198 lesson: binding a BigInt to
 * postgres.js broke production).
 */
export function compareArchiveIds(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Confirms one received message for `chatId`: the origin id joins the chat's
 * queue, and one HTTP call carries the chat's ids after a 1 s quiet period (a
 * newer confirm replaces the pending wait, so the latest id wins, the way
 * `recordRead` debounces). Own messages are ignored by the server. Errors are
 * ignored.
 */
export function confirmDelivered(ctx: CoreCtx, chatId: string, originId: string): void {
  if (originId === '') {
    return;
  }
  const queues = queueOf(ctx);
  const ids = queues.get(chatId) ?? [];
  if (!ids.includes(originId)) {
    ids.push(originId);
    if (ids.length > MARK_DELIVERED_MAX) {
      ids.splice(0, ids.length - MARK_DELIVERED_MAX);
    }
  }
  queues.set(chatId, ids);
  ctx.rt.forkKeyed(
    `mark-delivered:${chatId}`,
    Effect.sleep(MARK_DELIVERED_DEBOUNCE_MS).pipe(
      Effect.andThen(Effect.suspend(() => flushDelivered(ctx, chatId))),
      Effect.ignore,
    ),
  );
}

// Sends the chat's queued ids (newest last) and drops them; best effort.
function flushDelivered(ctx: CoreCtx, chatId: string): Effect.Effect<void> {
  const send = ctx.ports.api.markChatDelivered;
  const ids = queueOf(ctx).get(chatId);
  if (send === undefined || ids === undefined || ids.length === 0) {
    return Effect.void;
  }
  queueOf(ctx).delete(chatId);
  const batch = ids.slice(-MARK_DELIVERED_MAX);
  return Effect.tryPromise({ try: () => send(chatId, batch), catch: (error) => error }).pipe(
    Effect.ignore,
    Effect.asVoid,
  );
}

// The archive id of one of my messages: its own id when numeric (a server
// stanza id), else the server id the ledger linked to it. An own echo records
// that link (`linkLocalToServer`, `incoming.ts`) and `wireTargetFor` reads it
// back; a message with no known archive id is left alone. Exported so T-1247's
// delete-for-me reuses the same lookup.
export function archiveIdOf(ctx: CoreCtx, message: UiMessage): string | undefined {
  if (isArchiveId(message.id)) {
    return message.id;
  }
  const wire = ctx.k.wireTargetFor(message.id);
  return wire !== undefined && isArchiveId(wire) ? wire : undefined;
}

/**
 * Moves my own messages of `chatId` whose archive id is at or below the server
 * mark to `status`, through `advanceStatus`: a message further along the ladder
 * keeps its status and a later message stays `sent`. A non-numeric mark is
 * ignored.
 */
export function applyStatusUntil(
  ctx: CoreCtx,
  chatId: string,
  until: string,
  status: 'delivered' | 'read',
): void {
  if (!isArchiveId(until)) {
    return;
  }
  const state = ctx.get();
  const messages = state.messagesByChat[chatId];
  if (messages === undefined || messages.length === 0) {
    return;
  }
  const me = state.currentUserId;
  let changed = false;
  const next = messages.map((message) => {
    if (message.senderId !== me) {
      return message;
    }
    const archiveId = archiveIdOf(ctx, message);
    if (archiveId === undefined || compareArchiveIds(archiveId, until) > 0) {
      return message;
    }
    const advanced = advanceStatus(message.status, status);
    if (advanced === message.status) {
      return message;
    }
    changed = true;
    return { ...message, status: advanced };
  });
  if (!changed) {
    return;
  }
  ctx.set((previous) => ({ messagesByChat: { ...previous.messagesByChat, [chatId]: next } }));
}

/**
 * Moves my own messages of `chatId` whose archive id is at or below the server
 * mark to `delivered`, through `advanceStatus`: a `read` message stays `read`
 * and a later message stays `sent`. A non-numeric mark is ignored.
 */
export function applyDeliveredUntil(ctx: CoreCtx, chatId: string, until: string): void {
  applyStatusUntil(ctx, chatId, until, 'delivered');
}

/**
 * Applies one fresh `/api/chats` row: confirm the newest preview (its `id` is
 * the origin id) and apply the delivered mark the row carries. The shared
 * per-row helper both apps call from their chat-list merge.
 */
export function applyChatDelivery(ctx: CoreCtx, row: ChatSummary): void {
  if (row.lastMessage !== undefined) {
    confirmDelivered(ctx, row.id, row.lastMessage.id);
  }
  if (row.deliveredUntil !== undefined) {
    applyDeliveredUntil(ctx, row.id, row.deliveredUntil);
  }
}

// Keeps the chat summary's delivered mark forward only, so a history page that
// loads after a live notice still applies it (T-1245).
function storeDeliveredUntil(ctx: CoreCtx, chatId: string, until: string): void {
  if (!isArchiveId(until)) {
    return;
  }
  const existing = ctx.get().chats.find((chat) => chat.id === chatId)?.deliveredUntil;
  if (existing !== undefined && compareArchiveIds(until, existing) <= 0) {
    return;
  }
  ctx.set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, deliveredUntil: until } : chat,
    ),
  }));
}

/**
 * Applies one live delivered notice the server pushed for one chat (T-1245):
 * moves my own messages at or below the mark to `delivered` and stores the
 * mark on the chat summary. Wired to the core's `deliveredMark` event in
 * `lifecycle.ts`.
 */
export function handleDeliveredMark(ctx: CoreCtx, event: { chatJid: string; until: string }): void {
  applyDeliveredUntil(ctx, event.chatJid, event.until);
  storeDeliveredUntil(ctx, event.chatJid, event.until);
}
