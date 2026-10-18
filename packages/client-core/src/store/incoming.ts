// What the XMPP core tells the store: messages, typing, read markers, room occupants and
// presence. The core calls these listeners synchronously in emit order, so the store updates
// before the next event; the timers they start run as fibers.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { isAiJid } from '@zilar/protocol';
import type { ChatMessage, Occupant, PresenceEvent } from '@zilar/xmpp-core';
import type { CoreCtx, StoreAppHooks } from './ctx';
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
import { addTyper, clearChatTyping, removeTyper, setStatus, TYPING_CLEAR_MS } from './typing';

// A typing line clears this long after the last composing event; still exported from here
// so the apps' re-export keeps working.
export { TYPING_CLEAR_MS };

export const CHAT_REFRESH_DEBOUNCE_MS = 500;

// The topic list follows AI activity live: a card that starts, ends or waits on a task
// means the server's view changed, so refresh the list a few seconds later, once per burst.
// A client only receives room messages for rooms it may read, so this reveals nothing new.

/** How long a refresh waits: a turn's start and its first steps cost one fetch. */
const ACTIVITY_REFRESH_DELAY_MS = 3000;

const ACTIVITY_REFRESH_KEY = 'ai-activity-refresh';

/**
 * The live group messages whose card changes a topic's AI activity: a new `progress`
 * card (a turn started), its terminal correction, an `approval.request` or a `question`.
 */
export function isAiActivityMessage(message: ChatMessage): boolean {
  if (message.kind !== 'groupchat') {
    return false;
  }
  const payload = message.payload;
  if (payload === undefined) {
    return false;
  }
  if (payload.type === 'progress') {
    const state = payload.data.state;
    return (
      message.correction === undefined ||
      state === 'done' ||
      state === 'failed' ||
      state === 'stopped'
    );
  }
  return (
    (payload.type === 'approval.request' || payload.type === 'question') &&
    message.correction === undefined
  );
}

/**
 * Refreshes the chat list once, `ACTIVITY_REFRESH_DELAY_MS` after the first activity of a
 * burst; the timer is a keyed store fiber, so it dies with `stop()`.
 */
function scheduleActivityRefresh(ctx: CoreCtx): void {
  if (ctx.rt.has(ACTIVITY_REFRESH_KEY)) {
    return;
  }
  // `CoreCtx` narrows `fx` to `CoreHooks`; both apps pass the full `StoreAppHooks`, which
  // carries the chat-list refresh this needs.
  const { scheduleChatsRefresh } = ctx.fx as StoreAppHooks;
  ctx.rt.forkKeyed(
    ACTIVITY_REFRESH_KEY,
    Effect.sleep(ACTIVITY_REFRESH_DELAY_MS).pipe(
      Effect.andThen(Effect.sync(() => scheduleChatsRefresh())),
    ),
  );
}

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
    // An echo is proof the stanza reached the server: a bubble marked `failed` moves to
    // `sent` and its retry bytes can go. `advanceStatus` still stops a later downgrade.
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
  // The reconcile wrote the raw echo, so an edit filed under the optimistic id is gone;
  // re-apply it. A correction or reaction-only stanza returned earlier.
  k.resolvePendingEdits(chatId);
  k.refreshEdits(chatId);
  k.refreshReactions(chatId);
  // A carbon of my own message from another device means I read the chat there, so the
  // badge here goes; it sends no displayed marker.
  if (localId === undefined) {
    recordRead(ctx, chatId, ui.id);
  }
}

export function handleMessage(ctx: CoreCtx, message: ChatMessage): void {
  const { k } = ctx;
  if (isAiActivityMessage(message)) scheduleActivityRefresh(ctx);
  // A correction or retraction is never a chat message; it edits another and returns before
  // rendering. A routine edit in the chat I'm reading is read, so it never bumps unread.
  if (k.isEditStanza(message)) {
    k.ingestEdit(message);
    if (
      message.payload?.type === 'routine' &&
      ctx.get().activeChatId === message.chatJid &&
      ctx.ports.isVisible()
    ) {
      recordRead(ctx, message.chatJid, message.correction?.targetId);
    }
    return;
  }
  // A reactions-only message must never render or move the preview; one that also carries
  // a body or payload is a normal message.
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

  // A resend arrives live with a new stanza-id but the same origin id, already aliased to
  // the first copy: drop it before any side effect.
  const existing = k.listFor(ctx.get(), chatId);
  if (existing.some((item) => item.id !== ui.id && k.sameMessage(item.id, ui.id))) {
    return;
  }

  // Holding this message proves delivery, so confirm it (debounced per chat); an AI-only DM
  // has no peer device, so its call is skipped.
  const chat = ctx.get().chats.find((entry) => entry.id === chatId);
  if (message.originId !== undefined && chat?.isAI !== true) {
    confirmDelivered(ctx, chatId, message.originId);
  }

  // A peer's message proves they stopped typing: drop the line now, not up to five seconds
  // later.
  if (chat !== undefined && chat.kind === 'group') {
    removeTyper(ctx, chatId, message.fromJid);
  } else {
    clearChatTyping(ctx, chatId);
  }

  const active = ctx.get().activeChatId === chatId && ctx.ports.isVisible();
  const isRead = active;
  // An album counts once: later photos share the album id with a message already in the
  // list from the same sender.
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
  event: {
    chatJid: string;
    fromJid: string;
    state: string;
    status?: string;
    outgoing: boolean;
  },
): void {
  // A MUC reflects my own chat states back. When the sender cannot be resolved to a real
  // JID, xmpp-core marks it `outgoing` and keeps the full room JID, so the JID check alone
  // is not enough.
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
    // Only an AI sender may carry a status text: a human client could otherwise spoof the
    // AI status line, so the sender decides, not the field.
    if (event.status !== undefined && isAiJid(event.fromJid)) {
      setStatus(ctx, chatId, event.fromJid, event.status);
    }
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
    // A presence burst repeats the same counts; rebuilding `chats` would re-render every
    // subscriber. Return `state` itself when nothing visible changed.
    if (chat.onlineCount === onlineCount && chat.memberCount === memberCount) {
      return state;
    }
    const chats = state.chats.slice();
    chats[index] = { ...chat, onlineCount, memberCount };
    return { chats };
  });
}

function sameInstant(left: Date | undefined, right: Date): boolean {
  return left !== undefined && left.getTime() === right.getTime();
}

/**
 * The chat after one presence event, or the very same object when the event changes
 * nothing visible (a repeated availability must not rebuild `chats`). Without a delay
 * stamp, only a real online-to-offline transition re-stamps `lastSeenAt`.
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
