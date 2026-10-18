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
  /** T-1274: an album's members, so Delete acts on the whole album. */
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
  /** The sheet closed itself (drag, backdrop tap, Android back). */
  onMenuClosed: () => void;
};

function copyMessageText(text: string): void {
  Effect.runFork(Effect.tryPromise(() => Clipboard.setStringAsync(text)).pipe(Effect.ignore));
}

// The haptic is a native call the press does not wait for; it starts here,
// in the press handler, and a failed haptic is ignored.
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
  // The failed-text Retry/Delete and the T-1247 delete-for-me read straight
  // from the store (like `chat-thread.tsx` reads `retrySticker`): threading
  // them down would need `message-list.tsx`, which this task does not own.
  const retryText = useChatStore((state) => state.retryText);
  const deleteFailedMessage = useChatStore((state) => state.deleteFailedMessage);
  const deleteForMe = useChatStore((state) => state.deleteForMe);
  const currentUserId = useChatStore((state) => state.currentUserId);
  // The chat's one toast, for the "Copied" confirmation (T-1693). A sheet
  // drawn outside a thread gets the no-op.
  const notify = useChatNotice();
  // T-1274: on an album bubble Delete acts on every photo. The bubble hands
  // over the grid's grouped members when its menu opens; with two or more, both
  // confirms loop over all of them (an album is one sender, so the own/peer
  // rule is unchanged). A lone photo keeps the single-message action.
  const deleteTargets = albumMembers ?? [message];
  const deleteTitle = albumMembers === undefined ? undefined : 'Delete album?';
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
  // A message with no wire id yet (still sending, or a failed send) is refused
  // by React, Edit and Delete: the sheet disables them instead of letting the
  // tap do nothing (UI-7).
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
