import type { ReactionsState, UiReaction } from '@zilar/chat-core';
import {
  applyReaction,
  emptyReactions,
  reactionChips as sharedReactionChips,
  reactionsEqual,
} from '@zilar/chat-core';
import type { LedgerIds } from './ledger-ids';
import type { LedgerIdentity } from './ledger-identity';
import type { LedgerSet, LedgerState, LedgerStanza, StoreMessage } from './ledger-types';

interface LedgerReactionsDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
  readonly identity: LedgerIdentity;
}

export function createLedgerReactions(deps: LedgerReactionsDeps) {
  const { get, set } = deps;
  const { aliasRoot } = deps.ids;
  const { myJid, reactorName } = deps.identity;

  function reactionChips(
    state: ReactionsState | undefined,
    chatId: string,
    messageId: string,
  ): UiReaction[] | undefined {
    return sharedReactionChips(state, chatId, messageId, { aliasRoot, myJid, reactorName });
  }

  function refreshReactions(chatId: string): void {
    const state = get();
    const list = state.messagesByChat[chatId];
    const reactions = state.reactions[chatId];
    if (list === undefined || reactions === undefined) {
      return;
    }
    let changed = false;
    const next = list.map((message) => {
      const chips = reactionChips(reactions, chatId, message.id);
      if (reactionsEqual(message.reactions, chips)) {
        return message;
      }
      changed = true;
      if (chips === undefined) {
        const withoutReactions: StoreMessage = { ...message };
        delete withoutReactions.reactions;
        return withoutReactions;
      }
      return { ...message, reactions: chips };
    });
    if (!changed) {
      return;
    }
    set((previous) => ({ messagesByChat: { ...previous.messagesByChat, [chatId]: next } }));
  }

  // Records one reaction update; the target is canonicalised through the alias map to
  // match the id the message is known by.
  function recordReaction(
    chatId: string,
    targetId: string,
    reactorJid: string,
    emojis: string[],
    order: number,
  ): void {
    set((state) => ({
      reactions: {
        ...state.reactions,
        [chatId]: applyReaction(state.reactions[chatId] ?? emptyReactions(), {
          targetId: aliasRoot(targetId),
          reactorJid,
          emojis,
          order,
        }),
      },
    }));
  }

  function applyReactionUpdate(
    chatId: string,
    targetId: string,
    reactorJid: string,
    emojis: string[],
    order: number,
  ): void {
    recordReaction(chatId, targetId, reactorJid, emojis, order);
    refreshReactions(chatId);
  }

  function recordStanza(message: LedgerStanza): boolean {
    const reactions = message.reactions;
    if (reactions === undefined) {
      return false;
    }
    const mine = myJid();
    const reactorJid = message.outgoing && mine !== undefined ? mine : message.fromJid;
    recordReaction(
      message.chatJid,
      reactions.targetId,
      reactorJid,
      reactions.emojis,
      message.timestamp.getTime(),
    );
    return true;
  }

  // A reaction update is not a chat message: it never becomes a bubble or bumps the
  // preview or unread.
  function ingestReaction(message: LedgerStanza): void {
    if (recordStanza(message)) {
      refreshReactions(message.chatJid);
    }
  }

  // A history slice records every update first and re-attaches the chips once per chat,
  // so the list is walked once.
  function ingestHistoryReactions(messages: readonly LedgerStanza[]): void {
    const chats = new Set<string>();
    for (const message of messages) {
      if (recordStanza(message)) {
        chats.add(message.chatJid);
      }
    }
    for (const chatId of chats) {
      refreshReactions(chatId);
    }
  }

  return {
    reactionChips,
    refreshReactions,
    applyReactionUpdate,
    ingestReaction,
    ingestHistoryReactions,
  };
}

export type LedgerReactions = ReturnType<typeof createLedgerReactions>;
