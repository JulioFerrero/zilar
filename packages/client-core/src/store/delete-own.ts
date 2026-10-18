// Delete for me and clear history on the caller's own copy of a DM: call the API, and only
// after the server says yes remove the local rows. A failure keeps local state and shows one line.
import { Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import { type CoreCtx, fromPromise } from './ctx';
import { archiveIdOf } from './delivered';

export type DeleteOutcome = 'deleted' | 'unavailable' | 'failed';

export const DELETE_ERROR = 'Could not delete. Try again.';

// Drops a departed chat's preview without inventing one (`lastMessage` is optional).
function withoutLastMessage(chat: ChatSummary): ChatSummary {
  const next = { ...chat };
  delete next.lastMessage;
  return next;
}

function removeMessage(ctx: CoreCtx, chatId: string, messageId: string): void {
  ctx.set((state) => {
    const remaining = ctx.k.listFor(state, chatId).filter((item) => item.id !== messageId);
    const newest = remaining.at(-1);
    return {
      messagesByChat: { ...state.messagesByChat, [chatId]: remaining },
      chats: state.chats.map((chat) => {
        if (chat.id !== chatId || chat.lastMessage === undefined) {
          return chat;
        }
        if (!ctx.k.sameMessage(chat.lastMessage.id, messageId)) {
          return chat;
        }
        return newest === undefined ? withoutLastMessage(chat) : { ...chat, lastMessage: newest };
      }),
    };
  });
}

/** Deletes one message from the caller's own copy. A message without an archive id
 * answers `unavailable`; a failed call changes nothing and answers `failed`. */
export function deleteForMe(
  ctx: CoreCtx,
  chatId: string,
  messageId: string,
): Effect.Effect<DeleteOutcome> {
  return Effect.suspend(() => {
    // Prefer the exact id clicked; fall back to the alias-aware lookup so a message stored
    // under another id still resolves.
    const list = ctx.k.listFor(ctx.get(), chatId);
    const message =
      list.find((item) => item.id === messageId) ??
      list.find((item) => ctx.k.sameMessage(item.id, messageId));
    if (message === undefined) {
      return Effect.succeed('unavailable');
    }
    // The server wants the numeric archive id; otherwise name the message's own id, and
    // keep a still-unacked `local-*` id as no archive id at all.
    const archiveId =
      archiveIdOf(ctx, message) ?? (message.id.startsWith('local-') ? undefined : message.id);
    const send = ctx.ports.api.deleteMessageForMe;
    if (archiveId === undefined || send === undefined) {
      return Effect.succeed('unavailable');
    }
    return fromPromise(() => send(chatId, archiveId)).pipe(
      Effect.map(() => {
        removeMessage(ctx, chatId, message.id);
        return 'deleted' as const;
      }),
      Effect.catchCause(() =>
        Effect.sync(() => {
          ctx.set({ actionError: { chatId, message: DELETE_ERROR } });
          return 'failed' as const;
        }),
      ),
    );
  });
}

/** Clears the caller's own copy of a DM's history; the chat row stays in the list. A
 * failed call changes nothing and answers `failed`. */
export function clearHistory(ctx: CoreCtx, chatId: string): Effect.Effect<DeleteOutcome> {
  const send = ctx.ports.api.clearChatHistory;
  if (send === undefined) {
    return Effect.succeed('unavailable');
  }
  return fromPromise(() => send(chatId)).pipe(
    Effect.map(() => {
      ctx.set((state) => ({
        messagesByChat: { ...state.messagesByChat, [chatId]: [] },
        chats: state.chats.map((chat) =>
          chat.id === chatId ? withoutLastMessage({ ...chat, unread: 0 }) : chat,
        ),
      }));
      return 'deleted' as const;
    }),
    Effect.catchCause(() =>
      Effect.sync(() => {
        ctx.set({ actionError: { chatId, message: DELETE_ERROR } });
        return 'failed' as const;
      }),
    ),
  );
}
