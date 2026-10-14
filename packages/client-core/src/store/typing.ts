// The per-sender typing lines of the incoming path. The public state keeps one
// entry per chat (`typing[chatId] = { names, status? }`), but every sender gets
// their own name slot and their own clearing fiber, keyed by chat and sender
// JID: in a group two typers show as two names, and one sender's `paused` (or
// message, or timer) never clears another sender's line.
//
// T-1406: an AI's composing event may carry a short fixed status text. It keeps
// its own slot and its own (much longer) clearing fiber, so the header can show
// "<status>…" beside the dots while the AI works and plain dots afterwards. The
// same write wires `ChatSummary.aiStatus` (`working` while a status or a
// composing state is live, `idle` otherwise).
//
// The slots live beside the state (keyed by store context) because the public
// `CoreTyping` shape carries names and one status only; the state entry is
// rewritten from the slots on every change.
import { Effect } from 'effect';
import type { CoreCtx, CorePatch } from './ctx';

/** A typing line clears this long after the sender's last composing event. */
export const TYPING_CLEAR_MS = 5000;

/** T-1406: a status line clears this long after the sender's last update. */
export const STATUS_CLEAR_MS = 60_000;

const typingKey = (chatId: string, fromJid: string): string => `typing:${chatId}:${fromJid}`;
const statusKey = (chatId: string, fromJid: string): string => `status:${chatId}:${fromJid}`;

/** The typing senders of every chat, by store context: chat id, sender JID, name. */
const typingSenders = new WeakMap<CoreCtx, Map<string, Map<string, string>>>();

/** The AI statuses of every chat, by store context: chat id, sender JID, status. */
const typingStatuses = new WeakMap<CoreCtx, Map<string, Map<string, string>>>();

/** The most recent status in one chat, or undefined when none is live. */
function latestStatus(ctx: CoreCtx, chatId: string): string | undefined {
  const statuses = typingStatuses.get(ctx)?.get(chatId);
  if (statuses === undefined) {
    return undefined;
  }
  let latest: string | undefined;
  for (const status of statuses.values()) {
    latest = status;
  }
  return latest;
}

/**
 * Rewrites one chat's entry from its live name and status slots and wires the
 * chat's `aiStatus`: `working` while a status or a composing state is live,
 * `idle` otherwise. Both go out in one patch, so the list and the header read
 * one state.
 */
function writeTyping(ctx: CoreCtx, chatId: string): void {
  const names = [...(typingSenders.get(ctx)?.get(chatId)?.values() ?? [])];
  const status = latestStatus(ctx, chatId);
  const working = names.length > 0 || status !== undefined;
  ctx.set((state): CorePatch => {
    const patch: CorePatch = {};
    if (working) {
      patch.typing = {
        ...state.typing,
        [chatId]: { names, ...(status === undefined ? {} : { status }) },
      };
    } else if (state.typing[chatId] !== undefined) {
      const next = { ...state.typing };
      delete next[chatId];
      patch.typing = next;
    }
    const index = state.chats.findIndex((chat) => chat.id === chatId);
    const chat = state.chats[index];
    if (chat !== undefined && chat.isAI === true) {
      const nextStatus = working ? 'working' : 'idle';
      if (chat.aiStatus !== nextStatus) {
        const chats = state.chats.slice();
        chats[index] = { ...chat, aiStatus: nextStatus };
        patch.chats = chats;
      }
    }
    return patch;
  });
}

/** Drops one sender's name slot without touching their timer (the timer calls this). */
function dropTyper(ctx: CoreCtx, chatId: string, fromJid: string): void {
  const chats = typingSenders.get(ctx);
  const senders = chats?.get(chatId);
  if (senders === undefined || !senders.delete(fromJid)) {
    return;
  }
  if (senders.size === 0) {
    chats?.delete(chatId);
  }
  writeTyping(ctx, chatId);
}

/** Drops one sender's status slot without touching their timer (the timer calls this). */
function dropStatus(ctx: CoreCtx, chatId: string, fromJid: string): void {
  const chats = typingStatuses.get(ctx);
  const statuses = chats?.get(chatId);
  if (statuses === undefined || !statuses.delete(fromJid)) {
    return;
  }
  if (statuses.size === 0) {
    chats?.delete(chatId);
  }
  writeTyping(ctx, chatId);
}

/** Adds (or refreshes) one sender's name and re-arms their clearing fiber. */
export function addTyper(ctx: CoreCtx, chatId: string, fromJid: string, name: string): void {
  let chats = typingSenders.get(ctx);
  if (chats === undefined) {
    chats = new Map();
    typingSenders.set(ctx, chats);
  }
  let senders = chats.get(chatId);
  if (senders === undefined) {
    senders = new Map();
    chats.set(chatId, senders);
  }
  senders.set(fromJid, name);
  writeTyping(ctx, chatId);
  // One clearing fiber per (chat, sender); a new composing event replaces it.
  ctx.rt.forkKeyed(
    typingKey(chatId, fromJid),
    Effect.sleep(TYPING_CLEAR_MS).pipe(
      Effect.andThen(Effect.sync(() => dropTyper(ctx, chatId, fromJid))),
    ),
  );
}

/**
 * T-1406: adds (or refreshes) one sender's AI status and re-arms its clearing
 * fiber, which is far longer than the typing one so the text outlives the dots.
 */
export function setStatus(ctx: CoreCtx, chatId: string, fromJid: string, status: string): void {
  let chats = typingStatuses.get(ctx);
  if (chats === undefined) {
    chats = new Map();
    typingStatuses.set(ctx, chats);
  }
  let statuses = chats.get(chatId);
  if (statuses === undefined) {
    statuses = new Map();
    chats.set(chatId, statuses);
  }
  // Re-insert so the map order tracks recency: `latestStatus` reads the last
  // entry, and two AIs in one room must not make an older one win.
  statuses.delete(fromJid);
  statuses.set(fromJid, status);
  writeTyping(ctx, chatId);
  ctx.rt.forkKeyed(
    statusKey(chatId, fromJid),
    Effect.sleep(STATUS_CLEAR_MS).pipe(
      Effect.andThen(Effect.sync(() => dropStatus(ctx, chatId, fromJid))),
    ),
  );
}

/** Removes one sender's name and status and cancels their clearing fibers. */
export function removeTyper(ctx: CoreCtx, chatId: string, fromJid: string): void {
  ctx.rt.cancel(typingKey(chatId, fromJid));
  ctx.rt.cancel(statusKey(chatId, fromJid));
  dropTyper(ctx, chatId, fromJid);
  dropStatus(ctx, chatId, fromJid);
}

/** Clears a chat's whole typing line and status and every sender fiber. */
export function clearChatTyping(ctx: CoreCtx, chatId: string): void {
  const chats = typingSenders.get(ctx);
  const senders = chats?.get(chatId);
  if (senders !== undefined) {
    for (const fromJid of senders.keys()) {
      ctx.rt.cancel(typingKey(chatId, fromJid));
    }
    chats?.delete(chatId);
  }
  const statusChats = typingStatuses.get(ctx);
  const statuses = statusChats?.get(chatId);
  if (statuses !== undefined) {
    for (const fromJid of statuses.keys()) {
      ctx.rt.cancel(statusKey(chatId, fromJid));
    }
    statusChats?.delete(chatId);
  }
  writeTyping(ctx, chatId);
}
