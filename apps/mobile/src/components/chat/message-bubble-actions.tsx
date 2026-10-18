import { canAct, type UiMessage, type UiReaction } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Clipboard from 'expo-clipboard';

import { systemConfirmsCopy, useChatNotice } from '@/components/chat/chat-notice-context';
import { tap } from '@/components/chat/haptics';
import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { useChatStore } from '@/store/chat-store-provider';

type BubbleActionsSheetProps = {
  visible: boolean;
  confirmOpen: boolean;
  message: UiMessage;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canDeleteForMe: boolean;
  isDm: boolean;
  own: boolean;
  senderName: string;
  canForward: boolean;
  canPin: boolean | undefined;
  isPinned: boolean | undefined;
  myReactions: UiReaction[];
  albumMembers?: UiMessage[] | undefined;
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
  onMenuClosed: () => void;
};

function copyMessageText(text: string): void {
  Effect.runFork(Effect.tryPromise(() => Clipboard.setStringAsync(text)).pipe(Effect.ignore));
}

// The haptic starts in the press handler and is not awaited; a failed one is ignored.
export function openMessageMenu(open: () => void): void {
  tap();
  open();
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
  albumMembers,
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
  onMenuClosed,
}: BubbleActionsSheetProps) {
  // Failed-text Retry/Delete and delete-for-me read straight from the store, like `chat-thread.tsx`.
  const retryText = useChatStore((state) => state.retryText);
  const deleteFailedMessage = useChatStore((state) => state.deleteFailedMessage);
  const deleteForMe = useChatStore((state) => state.deleteForMe);
  const currentUserId = useChatStore((state) => state.currentUserId);
  // The chat's one toast, for the "Copied" confirmation; a sheet outside a thread gets the no-op.
  const notify = useChatNotice();
  // On an album bubble Delete acts on every photo; the bubble hands over the grid's members when its menu opens. An album is one sender, so the own/peer rule is unchanged.
  const deleteTargets = albumMembers ?? [message];
  const deleteTitle = albumMembers === undefined ? undefined : 'Delete album?';
  // A failed own text (the core's `retryText` guard, mirrored); attachments, stickers, voice notes and images keep their own retry paths.
  const failedText =
    message.senderId === currentUserId &&
    message.status === 'failed' &&
    message.text !== undefined &&
    message.voice === undefined &&
    message.attachment === undefined &&
    message.image === undefined &&
    message.card === undefined;
  // A message with no wire id yet (still sending, or failed) is refused by React, Edit and Delete: the sheet disables them instead of letting the tap do nothing.
  const canActNow = canAct(message);
  return (
    <MessageActionsSheet
      visible={visible}
      canCopy={canCopy}
      canEdit={canEdit && canActNow}
      canDelete={(canDelete || canDeleteForMe) && canActNow}
      canReact={canActNow}
      deleteLabel={isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone'}
      deleteTitle={deleteTitle}
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
        if (!systemConfirmsCopy()) {
          notify('Copied');
        }
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
        for (const target of deleteTargets) {
          onDelete?.(target);
        }
      }}
      onConfirmDeleteForMe={() => {
        setConfirmOpen(false);
        setMenuOpen(false);
        for (const target of deleteTargets) {
          void deleteForMe(target.chatId, target.id);
        }
      }}
      onReact={(emoji) => {
        setMenuOpen(false);
        react(message, emoji);
      }}
      onClose={onMenuClosed}
    />
  );
}
