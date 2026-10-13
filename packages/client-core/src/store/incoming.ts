// What the XMPP core tells the store: messages (new, echoed, corrections,
// reactions), typing, read markers, room occupants and presence. The core
// calls these listeners synchronously, in the order it emits, and the store
// updates its state before the next event arrives, so they stay plain
// callbacks over the shared `ctx`. The timers and the best-effort work they
// start (the typing clear, the badge) run as fibers.
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatMessage, Occupant, PresenceEvent } from '@zilar/xmpp-core';
import type { CoreCtx } from './ctx';
import { confirmDelivered } from './delivered';
import { recordRead } from './reads';
import {
  advanceStatus,
  coreKind,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortMessages,
  withoutDraft,
} from './rows';
import { addTyper, clearChatTyping, removeTyper, TYPING_CLEAR_MS } from './typing';

// A typing line clears this long after the last composing event: still
// exported from the incoming path, so the apps' re-export keeps working.
export { TYPING_CLEAR_MS };

/** How long a chat refresh waits after the last update event. */
export const CHAT_REFRESH_DEBOUNCE_MS = 500;

// Reconciles our optimistic message with the server echo. Sticker echoes carry
// the sticker id in the payload, so they match the sticker-scoped signature
// (not the bare emoji body).
function handleOutgoingEcho(ctx: CoreCtx, message: ChatMessage, ui: UiMessage): void {
  const { k } = ctx;
  const chatId = message.chatJid;
  const replyRef =
    message.replyTo === undefined ? undefined : { id: message.replyTo.id, senderName: '' };
  const signature =
    message.payload !== undefined && message.payload.type === 'sticker'
      ? k.stickerSignatureFor(chatId, message.body ?? '', message.payload.data.sticker_id, replyRef)
      : k.signatureFor(chatId, message.body ?? '', replyRef);
  const queue = ctx.pendingOutgoing.get(signature);
  const localId = queue?.shift();
  if (queue !== undefined && queue.length === 0) {
    ctx.pendingOutgoing.delete(signature);
  }
  if (localId !== undefined) {
    k.linkMessageIds(localId, ui.id);
    k.linkLocalToServer(localId, ui.id);
    // An echo is proof the stanza reached the server: a bubble the pipeline had
    // marked `failed` reached it after all, so it moves to `sent` and its
    // kept retry bytes can go, whichever pipeline stored them. `advanceStatus`
    // below still guards against a later `sending`/`failed` update downgrading
    // it again.
    k.clearSendFailure(chatId, ui.id);
    k.updateMessageStatus(chatId, ui.id, 'sent');
    const root = k.aliasRoot(localId);
    ctx.fx.forgetRetryBytes(localId);
    ctx.fx.forgetRetryBytes(root);
  }
  ctx.set((state) => {
    const existing = k.listFor(state, chatId);
    const previous = existing.find((item) => k.sameMessage(item.id, ui.id));
    const reconciled: UiMessage =
      previous === undefined ? ui : { ...ui, status: advanceStatus(previous.status, ui.status) };
    const withoutLocal =
      localId === undefined ? existing : existing.filter((item) => item.id !== localId);
    return {
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: sortMessages([
          ...withoutLocal.filter((item) => item.id !== reconciled.id),
          reconciled,
        ]),
      },
      chats: moveChatToTop(
        state.chats.map((chat) =>
          chat.id === chatId ? { ...chat, lastMessage: reconciled } : chat,
        ),
        chatId,
      ),
    };
  });
  // The reconcile above wrote the raw echo, so an edit made after the ack (and
  // filed under the optimistic id) is gone from the bubble. Re-apply the three
  // the incoming path does below. A correction or a reaction-only stanza
  // returned before this point, so neither reaches here.
  k.resolvePendingEdits(chatId);
  k.refreshEdits(chatId);
  k.refreshReactions(chatId);
  // A carbon of my own message from another device (`localId` undefined: no
  // optimistic bubble on this device) means I read the chat there, so the
  // badge here goes. Sends no displayed marker.
  if (localId === undefined) {
    recordRead(ctx, chatId, ui.id);
  }
}

export function handleMessage(ctx: CoreCtx, message: ChatMessage): void {
  const { k } = ctx;
  // A correction or a retraction is never a chat message: it edits another
  // one, so it is ingested and returns before any rendering.
  if (k.isEditStanza(message)) {
    k.ingestEdit(message);
    return;
  }
  // A reactions message that is only that (no body, no payload) must never
  // render as a bubble or move the chat list preview. A message that also
  // carries a body or payload is a normal message: its reactions are ingested
  // and it is rendered as usual.
  if (message.reactions !== undefined) {
    k.ingestReaction(message);
    if (k.isReactionOnly(message)) {
      return;
    }
  }
  const meId = ctx.get().currentUserId;
  const chatId = message.chatJid;
  const ui = k.toUiMessage(message, meId);

  if (message.outgoing) {
    handleOutgoingEcho(ctx, message, ui);
    return;
  }

  // A resend arrives live with a new stanza-id but the same origin id
  // (T-1216): `toUiMessage` above already recorded this stanza's origin id
  // and aliased it to the first copy (`ledger-incoming.ts`), so a chat that
  // already holds a `sameMessage` with a different id has this bubble. Drop
  // the copy before any side effect: no second bubble, no unread bump, no
  // preview move.
  const existing = k.listFor(ctx.get(), chatId);
  if (existing.some((item) => item.id !== ui.id && k.sameMessage(item.id, ui.id))) {
    return;
  }

  // Holding this received message is proof of delivery (T-1238): confirm it
  // over HTTP, debounced per chat. An AI-only DM has no peer device, so its
  // call is skipped to save it (the server ignores the caller's own rows).
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (message.originId !== undefined && chat?.isAI !== true) {
    confirmDelivered(ctx, chatId, message.originId);
  }

  // A peer's message proves they stopped typing: the line must go with the
  // bubble, not up to five seconds after it. In a group only that sender's
  // name goes; in a DM the whole line goes.
  if (chat !== undefined && chat.kind === 'group') {
    removeTyper(ctx, chatId, message.fromJid);
  } else {
    clearChatTyping(ctx, chatId);
  }

  const active = ctx.get().activeChatId === chatId && ctx.ports.isVisible();
  const isRead = active;
  // An album's first photo bumps the badge; its later photos share the album
  // id with a message already in the list from the same sender, so they add
  // nothing — the album counts once (T-1272).
  const albumId = ui.album?.id;
  const laterAlbumPhoto =
    albumId !== undefined &&
    existing.some((item) => item.album?.id === albumId && item.senderId === ui.senderId);
  const unreadDelta = isRead || laterAlbumPhoto ? 0 : 1;
  // Only the AI's own message in its DM finishes the draft. A message from my
  // own JID (e.g. my second device) must leave the draft running.
  const fromAi = message.fromJid === chatId && !k.isOwnSender(message.fromJid);
  // A progress message (a tool round in flight) is not the reply: the draft
  // must keep streaming while later rounds run.
  const finishesDraft = fromAi && message.payload?.type !== 'progress';
  const draft = ctx.get().drafts[chatId];
  if (draft !== undefined && finishesDraft) {
    ctx.fx.finishDraftTurn(chatId, draft.turnId);
  }
  ctx.set((state) => ({
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: sortMessages([...k.listFor(state, chatId).filter((item) => item.id !== ui.id), ui]),
    },
    chats: moveChatToTop(
      state.chats.map((chat) =>
        chat.id === chatId
          ? { ...chat, lastMessage: ui, unread: isRead ? 0 : chat.unread + unreadDelta }
          : chat,
      ),
      chatId,
    ),
    // The final message replaces the draft in one update: the bubble never
    // leaves the screen, so there is no gap and no duplicate.
    drafts:
      draft !== undefined && finishesDraft ? withoutDraft(state.drafts, chatId) : state.drafts,
    // Remember the turn so the bubble keeps revealing on the draft's key.
    finishedDraftMessages:
      draft !== undefined && finishesDraft
        ? rememberFinishedDraftMessage(state.finishedDraftMessages, ui.id, draft.turnId)
        : state.finishedDraftMessages,
  }));
  // A message that just loaded may be the target of a correction or a
  // retraction read earlier, from an older history page.
  k.resolvePendingEdits(chatId);
  k.refreshEdits(chatId);
  if (!isRead) {
    ctx.fx.syncBadge();
    ctx.fx.notifyIncoming?.(chatId, ui);
  }
  if (isRead && ctx.core !== undefined) {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    if (chat !== undefined) {
      recordRead(ctx, chatId, ui.id);
      ctx.core.markDisplayed(chatId, coreKind(chat), ui.id);
    }
  }
}

export function handleTyping(
  ctx: CoreCtx,
  event: { chatJid: string; fromJid: string; state: string; outgoing: boolean },
): void {
  // A MUC reflects my own chat states back to me. When the sender cannot be
  // resolved to a real JID, xmpp-core marks the reflection `outgoing` and keeps
  // the full room JID, so the JID check alone is not enough.
  if (event.outgoing || ctx.k.isOwnSender(event.fromJid)) {
    return;
  }
  const chatId = event.chatJid;
  ctx.fx.loadGroupMembers(chatId);
  const name = ctx.k.senderNameFor({
    chatJid: chatId,
    fromJid: event.fromJid,
    outgoing: false,
  } as ChatMessage);
  if (event.state === 'composing') {
    addTyper(ctx, chatId, event.fromJid, name);
  } else {
    removeTyper(ctx, chatId, event.fromJid);
  }
}

export function handleDisplayed(
  ctx: CoreCtx,
  event: { chatJid: string; fromJid: string; messageId: string; outgoing: boolean },
): void {
  // A reflected marker of my own message means I displayed it, not that a peer
  // read it. `outgoing` covers the unresolved full-room-JID case.
  if (event.outgoing || ctx.k.isOwnSender(event.fromJid)) {
    return;
  }
  ctx.k.updateMessageStatus(event.chatJid, event.messageId, 'read');
}

export function handleOccupants(
  ctx: CoreCtx,
  event: { roomJid: string; occupants: Occupant[] },
): void {
  ctx.set((state) => {
    const index = state.chats.findIndex((chat) => chat.id === event.roomJid);
    const chat = state.chats[index];
    if (chat === undefined) {
      return state;
    }
    const onlineCount = event.occupants.filter((occupant) => occupant.available).length;
    const memberCount = Math.max(chat.memberCount ?? 0, event.occupants.length);
    // PERF-7: a MUC presence burst repeats the same counts, and rebuilding
    // `chats` would re-render every subscriber of the list. Nothing visible
    // changed: return `state` itself, which the store skips (same object).
    if (chat.onlineCount === onlineCount && chat.memberCount === memberCount) {
      return state;
    }
    const chats = state.chats.slice();
    chats[index] = { ...chat, onlineCount, memberCount };
    return { chats };
  });
}

/** The same instant, so a repeated stamped presence does not re-stamp. */
function sameInstant(left: Date | undefined, right: Date): boolean {
  return left !== undefined && left.getTime() === right.getTime();
}

/**
 * The chat after one presence event, or the very same object when the event
 * changes nothing visible (PERF-7: a repeated availability must not rebuild
 * `chats`). Without a delay stamp, only a real online-to-offline transition
 * re-stamps `lastSeenAt`.
 */
function chatAfterPresence(ctx: CoreCtx, chat: ChatSummary, event: PresenceEvent): ChatSummary {
  if (event.available) {
    return chat.online === true ? chat : { ...chat, online: true };
  }
  if (event.delayedAt !== undefined) {
    const lastSeenAt = new Date(event.delayedAt);
    if (chat.online === false && sameInstant(chat.lastSeenAt, lastSeenAt)) {
      return chat;
    }
    return { ...chat, online: false, lastSeenAt };
  }
  if (chat.online === false) {
    return chat;
  }
  if (chat.online === true) {
    return { ...chat, online: false, lastSeenAt: ctx.ports.now() };
  }
  return { ...chat, online: false };
}

export function handlePresence(ctx: CoreCtx, event: PresenceEvent): void {
  ctx.set((state) => {
    const index = state.chats.findIndex((chat) => chat.id === event.jid);
    const chat = state.chats[index];
    if (chat === undefined) {
      return state;
    }
    const next = chatAfterPresence(ctx, chat, event);
    if (next === chat) {
      return state;
    }
    const chats = state.chats.slice();
    chats[index] = next;
    return { chats };
  });
}
