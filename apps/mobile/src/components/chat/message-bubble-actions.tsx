import { type UiMessage, type UiReaction } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { useChatStore } from '@/store/chat-store-provider';

type BubbleActionsSheetProps = {
  visible: boolean;
  confirmOpen: boolean;
  message: UiMessage;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** T-1247: any deletable DM message, including the peer's. */
  canDeleteForMe: boolean;
  /** T-1247: a DM (not a group or AI chat). */
  isDm: boolean;
  /** T-1247: this message is my own. */
  own: boolean;
  /** T-1247: the sender's name, for the DM confirm body. */
  senderName: string;
  canForward: boolean;
  canPin: boolean | undefined;
  isPinned: boolean | undefined;
  myReactions: UiReaction[];
  onReply: (message: UiMessage) => void;
  onEdit: ((message: UiMessage) => void) | undefined;
  onDelete: ((message: UiMessage) => void) | undefined;
  onForward: ((message: UiMessage) => void) | undefined;
  onStartSelect: ((message: UiMessage) => void) | undefined;
  onPin: ((message: UiMessage) => void) | undefined;
  onUnpin: ((message: UiMessage) => void) | undefined;
  react: (message: UiMessage, emoji: string) => void;
  setMenuOpen: (open: boolean) => void;
  setConfirmOpen: (open: boolean) => void;
};

function copyMessageText(text: string): void {
  Effect.runFork(Effect.tryPromise(() => Clipboard.setStringAsync(text)).pipe(Effect.ignore));
}

// The haptic is a native call the press does not wait for; it starts here,
// in the press handler, and a failed haptic is ignored.
export function openMessageMenu(setMenuOpen: (open: boolean) => void): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
  setMenuOpen(true);
}

export function BubbleActionsSheet({
  visible,
  confirmOpen,
  message,
  canCopy,
  canEdit,
  canDelete,
  canDeleteForMe,
  isDm,
  own,
  senderName,
  canForward,
  canPin,
  isPinned,
  myReactions,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onStartSelect,
  onPin,
  onUnpin,
  react,
  setMenuOpen,
  setConfirmOpen,
}: BubbleActionsSheetProps) {
  // The failed-text Retry/Delete and the T-1247 delete-for-me read straight
  // from the store (like `chat-thread.tsx` reads `retrySticker`): threading
  // them down would need `message-list.tsx`, which this task does not own.
  const retryText = useChatStore((state) => state.retryText);
  const deleteFailedMessage = useChatStore((state) => state.deleteFailedMessage);
  const deleteForMe = useChatStore((state) => state.deleteForMe);
  const currentUserId = useChatStore((state) => state.currentUserId);
  // A failed own text (the core's `retryText` guard, mirrored): attachments,
  // stickers, voice notes and images keep their own retry paths.
  const failedText =
    message.senderId === currentUserId &&
    message.status === 'failed' &&
    message.text !== undefined &&
    message.voice === undefined &&
    message.attachment === undefined &&
    message.image === undefined &&
    message.card === undefined;
  return (
    <MessageActionsSheet
      visible={visible}
      canCopy={canCopy}
      canEdit={canEdit}
      canDelete={canDelete || canDeleteForMe}
      deleteLabel={isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone'}
      ownDelete={isDm && own}
      dmDelete={isDm}
      senderName={senderName}
      failed={failedText}
      onRetry={() => {
        setMenuOpen(false);
        retryText(message.chatId, message.id);
      }}
      onDeleteLocal={() => {
        setMenuOpen(false);
        deleteFailedMessage(message.chatId, message.id);
      }}
      canForward={canForward}
      canPin={canPin}
      isPinned={isPinned}
      myReactions={myReactions}
      confirmOpen={confirmOpen}
      onReply={() => {
        setMenuOpen(false);
        onReply(message);
      }}
      onEdit={() => {
        setMenuOpen(false);
        onEdit?.(message);
      }}
      onCopy={() => {
        setMenuOpen(false);
        copyMessageText(message.text ?? '');
      }}
      onDelete={() => {
        setConfirmOpen(true);
      }}
      onForward={() => {
        setMenuOpen(false);
        onForward?.(message);
      }}
      {...(onStartSelect === undefined
        ? {}
        : {
            onSelect: () => {
              setMenuOpen(false);
              onStartSelect(message);
            },
          })}
      onPin={() => {
        setMenuOpen(false);
        if (isPinned === true) {
          onUnpin?.(message);
        } else {
          onPin?.(message);
        }
      }}
      onCloseConfirm={() => setConfirmOpen(false)}
      onConfirmDelete={() => {
        setConfirmOpen(false);
        setMenuOpen(false);
        onDelete?.(message);
      }}
      onConfirmDeleteForMe={() => {
        setConfirmOpen(false);
        setMenuOpen(false);
        void deleteForMe(message.chatId, message.id);
      }}
      onReact={(emoji) => {
        setMenuOpen(false);
        react(message, emoji);
      }}
      onClose={() => setMenuOpen(false)}
    />
  );
}
