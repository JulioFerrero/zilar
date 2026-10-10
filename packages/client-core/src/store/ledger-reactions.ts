// The ledger's reaction state: the chips shown on a message, applying a
// reaction update and re-attaching the chips to the loaded messages, and
// ingesting a reaction stanza or a slice of history. Moved unchanged from
// `store/ledger.ts` (size split).
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

  // Re-attaches the current chips to every loaded message of a chat after a
  // reaction update changed the derived state.
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

  // Applies one reaction update and refreshes the loaded messages. The target
  // is canonicalised through the alias map so it matches whatever id the
  // message is currently known by.
  function applyReactionUpdate(
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
    refreshReactions(chatId);
  }

  // A reaction update is not a chat message: it only changes reaction state,
  // so it never becomes a bubble or bumps the preview or unread count.
  function ingestReaction(message: LedgerStanza): void {
    const reactions = message.reactions;
    if (reactions === undefined) {
      return;
    }
    const mine = myJid();
    const reactorJid = message.outgoing && mine !== undefined ? mine : message.fromJid;
    applyReactionUpdate(
      message.chatJid,
      reactions.targetId,
      reactorJid,
      reactions.emojis,
      message.timestamp.getTime(),
    );
  }

  function ingestHistoryReactions(messages: readonly LedgerStanza[]): void {
    for (const message of messages) {
      ingestReaction(message);
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
