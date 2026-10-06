import type { UiReaction } from '@zilar/chat-core';
import { QUICK_REACTIONS } from '@zilar/chat-core';
import { Copy, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

type MessageActionsSheetProps = {
  visible: boolean;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Pin/Unpin for those allowed (undefined hides the row). */
  canPin?: boolean | undefined;
  isPinned?: boolean | undefined;
  /** My current reactions, so a chip I already reacted with is highlighted. */
  myReactions: UiReaction[];
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onPin?: () => void;
  /** Confirm-delete dialog state, controlled by the parent so the bubble can
   *  restore focus on close. */
  confirmOpen: boolean;
  onCloseConfirm: () => void;
  onConfirmDelete: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
};

/**
 * Bottom sheet with the quick-reaction bar and Reply / Edit / Copy text /
 * Delete for everyone. The delete confirm is a kit `ConfirmDialog`; the
 * parent just toggles `confirmOpen`.
 */
export function MessageActionsSheet({
  visible,
  canCopy,
  canEdit,
  canDelete,
  canPin,
  isPinned,
  myReactions,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onPin,
  confirmOpen,
  onCloseConfirm,
  onConfirmDelete,
  onReact,
  onClose,
}: MessageActionsSheetProps) {
  const myEmojiSet = new Set(myReactions.map((entry) => entry.emoji));

  return (
    <>
      <ActionSheet
        visible={visible && !confirmOpen}
        onClose={onClose}
        closeLabel="Close message menu"
        header={
          <View
            accessibilityRole="toolbar"
            accessibilityLabel="Reactions"
            className="flex-row items-center justify-around px-2 py-2"
          >
            {QUICK_REACTIONS.map((emoji) => {
              const mine = myEmojiSet.has(emoji);
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mine ? `Remove your reaction with ${emoji}` : `React with ${emoji}`
                  }
                  accessibilityState={{ selected: mine }}
                  onPress={() => onReact(emoji)}
                  className={cn(
                    'h-9 w-9 items-center justify-center rounded-full active:bg-surface-raised',
                    mine ? 'bg-[#ededed]' : null,
                  )}
                >
                  <Text className="text-[20px] leading-none">{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        }
      >
        <ActionSheetItem label="Reply" onPress={onReply} icon={Reply} />
        {canEdit ? (
          <ActionSheetItem
            label="Edit"
            accessibilityLabel="Edit message"
            onPress={onEdit}
            icon={Pencil}
          />
        ) : null}
        <ActionSheetItem label="Copy text" onPress={onCopy} disabled={!canCopy} icon={Copy} />
        <ActionSheetItem
          label="Delete for everyone"
          accessibilityLabel="Delete for everyone"
          onPress={onDelete}
          disabled={!canDelete}
          destructive
          icon={Trash2}
        />
        {canPin === true ? (
          <ActionSheetItem
            label={isPinned === true ? 'Unpin' : 'Pin'}
            accessibilityLabel={isPinned === true ? 'Unpin message' : 'Pin message'}
            onPress={onPin ?? (() => {})}
            icon={isPinned === true ? PinOff : Pin}
          />
        ) : null}
      </ActionSheet>
      <ConfirmDialog
        visible={visible && confirmOpen}
        title="Delete for everyone?"
        message="This deletes it for everyone in the chat."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={false}
        onCancel={onCloseConfirm}
        onConfirm={onConfirmDelete}
        cancelAccessibilityLabel="Cancel delete"
        confirmAccessibilityLabel="Delete"
      />
    </>
  );
}
