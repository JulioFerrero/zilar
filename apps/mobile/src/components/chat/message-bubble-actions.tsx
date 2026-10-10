import { type UiMessage, type UiReaction } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';

type BubbleActionsSheetProps = {
  visible: boolean;
  confirmOpen: boolean;
  message: UiMessage;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
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
  return (
    <MessageActionsSheet
      visible={visible}
      canCopy={canCopy}
      canEdit={canEdit}
      canDelete={canDelete}
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
      onReact={(emoji) => {
        setMenuOpen(false);
        react(message, emoji);
      }}
      onClose={() => setMenuOpen(false)}
    />
  );
}
