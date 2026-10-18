// A chat that is not open keeps at most its newest `KEEP_INACTIVE` messages, so browsing
// neither keeps their DOM nor grows `messagesByChat`. The open chat and any chat
// with work in flight are left alone; a pruned chat is marked incomplete so its next open
// pages the archive again.
import type { StoreMessage } from './ledger-types';
import type { HistoryCtx } from './history';

export const KEEP_INACTIVE = 300;

/**
 * Caps every chat but the open one to its newest `KEEP_INACTIVE` messages. Left alone: the
 * active chat, a chat with a send in flight (its bubble keeps its retry target) and a chat
 * with a live AI draft. Lists are oldest first, so the tail is the newest.
 */
export function pruneInactiveChats(ctx: HistoryCtx, activeChatId: string | null | undefined): void {
  const state = ctx.get();
  const messagesByChat: Record<string, StoreMessage[]> = {};
  const historyComplete: Record<string, boolean> = {};
  for (const [chatId, messages] of Object.entries(state.messagesByChat)) {
    if (chatId === activeChatId || messages.length <= KEEP_INACTIVE) {
      continue;
    }
    if (state.drafts[chatId] !== undefined) {
      continue;
    }
    if (messages.some((message) => message.status === 'sending')) {
      continue;
    }
    // The ids of the messages that leave the store go with them, so the ledger's id maps
    // the ledger's id maps do not grow for the life of the session.
    const kept = messages.slice(-KEEP_INACTIVE);
    messagesByChat[chatId] = kept;
    historyComplete[chatId] = false;
    ctx.k.forgetMessages(
      chatId,
      messages.slice(0, messages.length - kept.length).map((message) => message.id),
    );
  }
  if (Object.keys(messagesByChat).length === 0) {
    return;
  }
  ctx.set((previous) => ({
    messagesByChat: { ...previous.messagesByChat, ...messagesByChat },
    historyComplete: { ...previous.historyComplete, ...historyComplete },
  }));
}
