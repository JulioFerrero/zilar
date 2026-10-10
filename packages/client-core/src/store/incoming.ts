// What the XMPP core tells the store: messages (new, echoed, corrections,
// reactions), typing, read markers, room occupants and presence. The core
// calls these listeners synchronously, in the order it emits, and the store
// updates its state before the next event arrives, so they stay plain
// callbacks over the shared `ctx`. The timers and the best-effort work they
// start (the typing clear, the badge) run as fibers.
import { Effect } from 'effect';
import type { UiMessage } from '@zilar/chat-core';
import type { ChatMessage, Occupant, PresenceEvent } from '@zilar/xmpp-core';
import type { CoreCtx } from './ctx';
import { recordRead } from './reads';
import {
  advanceStatus,
  coreKind,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortMessages,
  withoutDraft,
} from './rows';

/** A typing line clears this long after the last composing event. */
export const TYPING_CLEAR_MS = 5000;

const typingKey = (chatId: string): string => `typing:${chatId}`;

const clearTyping = (ctx: CoreCtx, chatId: string): void => {
  ctx.set((state) => {
    const next = { ...state.typing };
    delete next[chatId];
    return { typing: next };
  });
};

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
    // marked `failed` is delivered after all, so it moves to `sent` and its
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

  const active = ctx.get().activeChatId === chatId && ctx.ports.isVisible();
  const isRead = active;
  // Only the AI's own message in its DM finishes the draft. A message from my
  // own JID (e.g. my second device) must leave the draft running.
  const fromAi = message.fromJid === chatId && !k.isOwnSender(message.fromJid);
  const draft = ctx.get().drafts[chatId];
  if (draft !== undefined && fromAi) {
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
          ? { ...chat, lastMessage: ui, unread: isRead ? 0 : chat.unread + 1 }
          : chat,
      ),
      chatId,
    ),
    // The final message replaces the draft in one update: the bubble never
    // leaves the screen, so there is no gap and no duplicate.
    drafts: draft !== undefined && fromAi ? withoutDraft(state.drafts, chatId) : state.drafts,
    // Remember the turn so the bubble keeps revealing on the draft's key.
    finishedDraftMessages:
      draft !== undefined && fromAi
        ? rememberFinishedDraftMessage(state.finishedDraftMessages, ui.id, draft.turnId)
        : state.finishedDraftMessages,
  }));
  // A message that just loaded may be the target of a correction or a
  // retraction read earlier, from an older history page.
  k.resolvePendingEdits(chatId);
  k.refreshEdits(chatId);
  if (!isRead) {
    ctx.fx.syncBadge();
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
    ctx.set((state) => ({ typing: { ...state.typing, [chatId]: { names: [name] } } }));
    // One clearing fiber per chat; a new composing event replaces it.
    ctx.rt.forkKeyed(
      typingKey(chatId),
      Effect.sleep(TYPING_CLEAR_MS).pipe(
        Effect.andThen(Effect.sync(() => clearTyping(ctx, chatId))),
      ),
    );
  } else {
    ctx.rt.cancel(typingKey(chatId));
    clearTyping(ctx, chatId);
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
  const online = event.occupants.filter((occupant) => occupant.available).length;
  ctx.set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === event.roomJid
        ? {
            ...chat,
            onlineCount: online,
            memberCount: Math.max(chat.memberCount ?? 0, event.occupants.length),
          }
        : chat,
    ),
  }));
}

export function handlePresence(ctx: CoreCtx, event: PresenceEvent): void {
  ctx.set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === event.jid
        ? {
            ...chat,
            online: event.available,
            ...(event.available ? {} : { lastSeenAt: ctx.ports.now() }),
          }
        : chat,
    ),
  }));
}
