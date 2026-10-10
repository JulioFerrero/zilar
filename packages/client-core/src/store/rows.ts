// Pure row helpers shared by the web and mobile chat stores. No state, no Effect.
import type { ChatSummary, MessageStatus, UiMessage } from '@zilar/chat-core';

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the app session.
export const FINISHED_TURNS_MAX = 50;

export function sortByRecency(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => {
    const leftTime = left.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });
}

/** The XMPP chat kind of a chat row. */
export function coreKind(chat: ChatSummary): 'chat' | 'groupchat' {
  return chat.kind === 'group' ? 'groupchat' : 'chat';
}

/** Drops the `failed` flag without leaving an `undefined` value behind. */
export function clearFailure(message: UiMessage): UiMessage {
  if (message.failed === undefined && message.failureReason === undefined) {
    return message;
  }
  const next: UiMessage = { ...message };
  delete next.failed;
  delete next.failureReason;
  return next;
}

/** Moves one chat row to the top of the list, keeping the others in order. */
export function moveChatToTop(chats: ChatSummary[], chatId: string): ChatSummary[] {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index <= 0) {
    return chats;
  }
  const next = [...chats];
  const [chat] = next.splice(index, 1);
  if (chat !== undefined) {
    next.unshift(chat);
  }
  return next;
}

// A status only moves forward: sending -> sent -> read. A late echo or send
// confirmation must never downgrade a message the peer already read. `failed`
// is outside the ladder: `advanceStatus` never moves into or out of it by
// accident, only an explicit retry does.
const STATUS_RANK: Record<MessageStatus, number> = {
  sending: 0,
  sent: 1,
  read: 2,
  failed: 2,
};

export function advanceStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
  if (current === 'failed' || next === 'failed') {
    return current;
  }
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

// Records which final message took over a draft's turn, capped like the
// finished-turn set. Insertion order is the cap order.
export function rememberFinishedDraftMessage(
  record: Record<string, string>,
  messageId: string,
  turnId: string,
): Record<string, string> {
  const next = { ...record, [messageId]: turnId };
  const keys = Object.keys(next);
  if (keys.length > FINISHED_TURNS_MAX) {
    for (const key of keys.slice(0, keys.length - FINISHED_TURNS_MAX)) {
      delete next[key];
    }
  }
  return next;
}

export function sortMessages(messages: UiMessage[]): UiMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}

export function withoutDraft<T>(drafts: Record<string, T>, chatId: string): Record<string, T> {
  if (drafts[chatId] === undefined) {
    return drafts;
  }
  const next = { ...drafts };
  delete next[chatId];
  return next;
}
