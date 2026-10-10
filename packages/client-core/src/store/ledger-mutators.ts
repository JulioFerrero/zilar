// The mutators every send and receive path goes through: status, voice and
// attachment updates, send-failure and retry transitions, failed-message
// removal and the sticker/attachment failure flags. Each keeps the message and,
// where the original did, the chat-list preview in step through
// `patchMessageAndLast`. Moved unchanged from `store/ledger.ts` (size split);
// the shared list-map + preview-mirror blocks are deduplicated per the split
// plan.
import type { Attachment, MessageStatus, SendFailureReason, VoiceMeta } from '@zilar/chat-core';
import { advanceStatus, clearFailure, sortMessages } from './rows';
import type { LedgerIds } from './ledger-ids';
import { listFor } from './ledger-signatures';
import type { LedgerSet, StoreMessage } from './ledger-types';

interface LedgerMutatorsDeps {
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
}

export function createLedgerMutators(deps: LedgerMutatorsDeps) {
  const { set } = deps;
  const { sameMessage } = deps.ids;

  // Updates a message in the open conversation and, when it is the same
  // message, in the chat list preview, so the two always agree.
  function patchMessageAndLast(
    chatId: string,
    messageId: string,
    update: (message: StoreMessage) => StoreMessage,
  ): void {
    set((state) => {
      const next = listFor(state, chatId).map((item) =>
        sameMessage(item.id, messageId) ? update(item) : item,
      );
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const updatedLast =
        last !== undefined && sameMessage(last.id, messageId) ? update(last) : undefined;
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: next },
        chats:
          updatedLast !== undefined && updatedLast !== last
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: updatedLast }
                  : chat,
              )
            : state.chats,
      };
    });
  }

  // Updates a message in the open conversation only, for the flags whose
  // original never mirrored to the chat-list preview.
  function patchMessage(
    chatId: string,
    messageId: string,
    update: (message: StoreMessage) => StoreMessage,
  ): void {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? update(item) : item,
        ),
      },
    }));
  }

  // Updates a message's status in the open conversation and, when it is the
  // same message, in the chat list preview, so the two always agree.
  function updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): void {
    patchMessageAndLast(chatId, messageId, (item) => ({
      ...item,
      status: advanceStatus(item.status, status),
    }));
  }

  // Swaps the placeholder voice metadata of an optimistic message for the
  // server's duration, waveform and upload URL.
  function updateMessageVoice(chatId: string, messageId: string, voice: VoiceMeta): void {
    patchMessageAndLast(chatId, messageId, (item) => ({ ...item, voice }));
  }

  // Swaps an optimistic attachment for the uploaded one: the served URL plus
  // any dimensions read from the local file.
  function updateMessageAttachment(
    chatId: string,
    messageId: string,
    attachment: Attachment,
  ): void {
    patchMessageAndLast(chatId, messageId, (item) => ({ ...clearFailure(item), attachment }));
  }

  // A failed voice or attachment send (T-0168): the bubble leaves
  // `sending` for `failed` with a fixed user-safe reason, keeping its local
  // blob/file so it can be retried. The `failed` flag mirrors the status
  // for readers that only check it. A failure never moves a message that
  // already settled (`sent`/`read`/`failed`): a late hang racing a success
  // must not downgrade it.
  function markSendFailed(chatId: string, messageId: string, reason: SendFailureReason): void {
    patchMessageAndLast(chatId, messageId, (item) =>
      item.status === 'sending'
        ? { ...item, status: 'failed' as const, failed: true, failureReason: reason }
        : item,
    );
  }

  // Clears a bubble's send-failure state (status back to `sending`-ladder
  // shape, flags dropped) without touching its content: used when a server
  // echo proves the stanza was delivered after all. Only `failed` bubbles
  // move; anything else is left alone.
  function clearSendFailure(chatId: string, messageId: string): void {
    patchMessageAndLast(chatId, messageId, (item) =>
      item.status === 'failed' ? { ...clearFailure(item), status: 'sent' as const } : item,
    );
  }

  // Moves a failed bubble back to `sending` for an explicit retry (T-0168).
  // Only `failed` messages move: this is the one path that may leave that
  // status, so `advanceStatus` can stay closed to it.
  function markSendRetrying(chatId: string, messageId: string): void {
    patchMessageAndLast(chatId, messageId, (item) =>
      item.status === 'failed' ? { ...clearFailure(item), status: 'sending' as const } : item,
    );
  }

  // Removes a failed local bubble (T-0168): the send never reached the
  // server, so there is nothing to retract — only a local message still in
  // `failed` status may go. The store drops its kept bytes first.
  function removeFailedMessage(chatId: string, messageId: string): void {
    set((state) => {
      const next = listFor(state, chatId).filter(
        (item) => !(item.status === 'failed' && sameMessage(item.id, messageId)),
      );
      if (next.length === listFor(state, chatId).length) {
        return state;
      }
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastMatches =
        last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: sortMessages(next) },
        chats: lastMatches
          ? state.chats.map((chat) => {
              if (chat.id !== chatId) {
                return chat;
              }
              const latest = [...next].reverse().find((item) => item.chatId === chatId);
              if (latest === undefined) {
                const { lastMessage: _dropped, ...rest } = chat;
                return rest;
              }
              return { ...chat, lastMessage: latest };
            })
          : state.chats,
      };
    });
  }

  // A failed sticker keeps the message and shows a Retry instead of a
  // silent "sending" state, like attachments do.
  function markStickerFailed(chatId: string, messageId: string): void {
    patchMessage(chatId, messageId, (item) => ({ ...item, failed: true }));
  }

  // A failed upload keeps the message and its local bytes, but shows a Retry
  // instead of a silent "sending" state.
  function markAttachmentFailed(chatId: string, messageId: string): void {
    patchMessage(chatId, messageId, (item) => ({ ...item, failed: true }));
  }

  return {
    updateMessageStatus,
    updateMessageVoice,
    updateMessageAttachment,
    markSendFailed,
    clearSendFailure,
    markSendRetrying,
    removeFailedMessage,
    markStickerFailed,
    markAttachmentFailed,
  };
}

export type LedgerMutators = ReturnType<typeof createLedgerMutators>;
