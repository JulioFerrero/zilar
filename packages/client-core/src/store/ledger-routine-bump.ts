// T-1722: the routine-edit bump. A correction that carries a `routine` payload
// (T-1721) moves its chat to the top with the edited text as its preview, like
// a new incoming message, and counts as unread unless the edit is my own. Kept
// beside `ledger-edits.ts` so that file stays under 400 lines.
import type { EditAuthor, TargetEdits } from '@zilar/chat-core';
import { listFor, previewFor } from './ledger-signatures';
import type { LedgerSet, LedgerState, StoreMessage } from './ledger-types';
import { moveChatToTop } from './rows';

/**
 * Whether a correction actually changed the target's stored edit state.
 * `applyEdit` returns a fresh state object even for a stale-order correction and
 * for a byte-identical re-apply, so a redelivered stanza (an XMPP stream
 * resumption) would look like a change and bump the chat again. Compare the
 * stored correction instead: the same text and order means nothing changed.
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
  /** Whether two message ids name the same message (`ledger-ids.ts`). */
  readonly sameMessage: (left: string, right: string) => boolean;
  /** The rendered message with its current edit state applied (`withEdits`). */
  readonly render: (message: StoreMessage, chatId: string) => StoreMessage;
}

export function createRoutineBump(deps: RoutineBumpDeps) {
  const { get, set } = deps;

  // The same test `incoming.ts` uses for a live message: my own JID.
  function isMine(author: EditAuthor): boolean {
    const mine = get().me?.jid;
    return mine !== undefined && mine !== null && mine !== '' && author.jid === mine;
  }

  // Moves the chat to the top with the edited target as its preview, and raises
  // its unread count the way a new message from someone else does.
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

export type RoutineBump = ReturnType<typeof createRoutineBump>;
