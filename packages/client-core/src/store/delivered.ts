// The delivered tick: a connected device confirms the messages it holds over HTTP and the
// sender applies the mark `/api/chats` reports. The mark is named by the origin id; the server
// keeps the max and ignores the caller's own messages, so confirming a preview is always safe.
// The queue lives beside the state, keyed by the store context.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { CoreCtx } from './ctx';
import { advanceStatus } from './rows';

export const MARK_DELIVERED_DEBOUNCE_MS = 1_000;
/** One confirmation call carries at most this many ids (the server's cap). */
export const MARK_DELIVERED_MAX = 50;

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
 * Compares two decimal archive ids as strings: length first, then lexicographically.
 * Never `BigInt`: binding one to postgres.js broke production.
 */
export function compareArchiveIds(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Confirms one received message: its origin id joins the chat's queue, and one HTTP call
 * carries the ids after a 1 s quiet period (a newer confirm replaces the pending wait). Own
 * messages are ignored by the server; errors are ignored.
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

// The archive id of one of my messages: its own id when numeric, else the server id the
// ledger linked to it (`linkLocalToServer` records that link). No known id means leave it alone.
export function archiveIdOf(ctx: CoreCtx, message: UiMessage): string | undefined {
  if (isArchiveId(message.id)) {
    return message.id;
  }
  const wire = ctx.k.wireTargetFor(message.id);
  return wire !== undefined && isArchiveId(wire) ? wire : undefined;
}

/**
 * Moves my own messages at or below the server mark to `status`; a message further along
 * the ladder keeps its status. A non-numeric mark is ignored.
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
 * Moves my own messages at or below the mark to `delivered`; a `read` message stays `read`.
 * A non-numeric mark is ignored.
 */
export function applyDeliveredUntil(ctx: CoreCtx, chatId: string, until: string): void {
  applyStatusUntil(ctx, chatId, until, 'delivered');
}

export function applyChatDelivery(ctx: CoreCtx, row: ChatSummary): void {
  if (row.lastMessage !== undefined) {
    confirmDelivered(ctx, row.id, row.lastMessage.id);
  }
  if (row.deliveredUntil !== undefined) {
    applyDeliveredUntil(ctx, row.id, row.deliveredUntil);
  }
}

// Keep the chat summary's delivered mark forward only, so a history page loaded later still
// applies it.
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

/** Applies one live delivered notice the server pushed for one chat. */
export function handleDeliveredMark(ctx: CoreCtx, event: { chatJid: string; until: string }): void {
  applyDeliveredUntil(ctx, event.chatJid, event.until);
  storeDeliveredUntil(ctx, event.chatJid, event.until);
}
