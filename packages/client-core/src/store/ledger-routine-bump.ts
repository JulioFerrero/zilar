// The routine-edit bump: a correction carrying a `routine` payload moves its chat to the
// top with the edited text as preview, and counts as unread unless the edit is my own.
import type { EditAuthor, TargetEdits } from '@zilar/chat-core';
import { listFor, previewFor } from './ledger-signatures';
import type { LedgerSet, LedgerState, StoreMessage } from './ledger-types';
import { moveChatToTop } from './rows';

/**
 * Whether a correction actually changed the target's edit state. `applyEdit` returns a
 * fresh object even for a stale-order or byte-identical re-apply, so a stream resumption
 * would look like a change and bump again; compare the stored correction instead.
 */
export function correctionChanged(
  before: TargetEdits | undefined,
  after: TargetEdits | undefined,
): boolean {
  const left = before?.correction;
  const right = after?.correction;
  if (left === undefined || right === undefined) {
    return left !== right;
  }
  return left.text !== right.text || left.order !== right.order;
}

interface RoutineBumpDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly sameMessage: (left: string, right: string) => boolean;
  readonly render: (message: StoreMessage, chatId: string) => StoreMessage;
}

export function createRoutineBump(deps: RoutineBumpDeps) {
  const { get, set } = deps;

  function isMine(author: EditAuthor): boolean {
    const mine = get().me?.jid;
    return mine !== undefined && mine !== null && mine !== '' && author.jid === mine;
  }

  // Moves the chat to the top with the edited target as its preview, raising its unread
  // like a new message from someone else.
  function bumpRoutineChat(chatId: string, targetId: string, author: EditAuthor): void {
    const mine = isMine(author);
    const target = listFor(get(), chatId).find((item) => deps.sameMessage(item.id, targetId));
    if (target === undefined) {
      set((state) => ({ chats: moveChatToTop(state.chats, chatId) }));
      return;
    }
    const preview = previewFor(deps.render(target, chatId));
    set((state) => ({
      chats: moveChatToTop(
        state.chats.map((chat) =>
          chat.id === chatId
            ? { ...chat, lastMessage: preview, unread: mine ? chat.unread : chat.unread + 1 }
            : chat,
        ),
        chatId,
      ),
    }));
  }

  return { bumpRoutineChat };
}
