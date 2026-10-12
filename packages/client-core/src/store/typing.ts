// The per-sender typing lines of the incoming path. The public state keeps one
// entry per chat (`typing[chatId] = { names }`), but every sender gets their own
// name slot and their own clearing fiber, keyed by chat and sender JID: in a
// group two typers show as two names, and one sender's `paused` (or message, or
// timer) never clears another sender's line.
//
// The slots live beside the state (keyed by store context) because the public
// `CoreTyping` shape carries names only; the state entry is rewritten from the
// slots on every change.
import { Effect } from 'effect';
import type { CoreCtx } from './ctx';

/** A typing line clears this long after the sender's last composing event. */
export const TYPING_CLEAR_MS = 5000;

const typingKey = (chatId: string, fromJid: string): string => `typing:${chatId}:${fromJid}`;

/** The typing senders of every chat, by store context: chat id, sender JID, name. */
const typingSenders = new WeakMap<CoreCtx, Map<string, Map<string, string>>>();

function writeTyping(ctx: CoreCtx, chatId: string, senders: Map<string, string>): void {
  ctx.set((state) => {
    if (senders.size === 0) {
      if (state.typing[chatId] === undefined) {
        return {};
      }
      const next = { ...state.typing };
      delete next[chatId];
      return { typing: next };
    }
    return { typing: { ...state.typing, [chatId]: { names: [...senders.values()] } } };
  });
}

/** Drops one sender's slot without touching their timer (the timer calls this). */
function dropTyper(ctx: CoreCtx, chatId: string, fromJid: string): void {
  const chats = typingSenders.get(ctx);
  const senders = chats?.get(chatId);
  if (senders === undefined || !senders.delete(fromJid)) {
    return;
  }
  if (senders.size === 0) {
    chats?.delete(chatId);
  }
  writeTyping(ctx, chatId, senders);
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
  writeTyping(ctx, chatId, senders);
  // One clearing fiber per (chat, sender); a new composing event replaces it.
  ctx.rt.forkKeyed(
    typingKey(chatId, fromJid),
    Effect.sleep(TYPING_CLEAR_MS).pipe(
      Effect.andThen(Effect.sync(() => dropTyper(ctx, chatId, fromJid))),
    ),
  );
}

/** Removes one sender's name and cancels their clearing fiber. */
export function removeTyper(ctx: CoreCtx, chatId: string, fromJid: string): void {
  ctx.rt.cancel(typingKey(chatId, fromJid));
  dropTyper(ctx, chatId, fromJid);
}

/** Clears a chat's whole typing line and every sender fiber (a DM message). */
export function clearChatTyping(ctx: CoreCtx, chatId: string): void {
  const chats = typingSenders.get(ctx);
  const senders = chats?.get(chatId);
  if (senders !== undefined) {
    for (const fromJid of senders.keys()) {
      ctx.rt.cancel(typingKey(chatId, fromJid));
    }
    chats?.delete(chatId);
  }
  ctx.set((state) => {
    if (state.typing[chatId] === undefined) {
      return {};
    }
    const next = { ...state.typing };
    delete next[chatId];
    return { typing: next };
  });
}
