import type { UiReaction } from '@zilar/chat-core';
import { QUICK_REACTIONS } from '@zilar/chat-core';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
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
 * Delete for everyone. The actual delete confirm dialog lives inside the
 * sheet so the layout is one place; the parent just toggles `confirmOpen`.
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
  const insets = useSafeAreaInsets();
  const myEmojiSet = new Set(myReactions.map((entry) => entry.emoji));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close message menu"
        onPress={confirmOpen ? onCloseConfirm : onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="overflow-hidden rounded-t-2xl border-t border-border-strong bg-surface"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          {confirmOpen ? (
            <View className="px-4 py-4">
              <Text className="text-[16px] font-semibold text-foreground">
                Delete for everyone?
              </Text>
              <Text className="mt-1 text-[14px] text-muted-foreground">
                This deletes it for everyone in the chat.
              </Text>
              <View className="mt-3 flex-row justify-end gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel delete"
                  onPress={onCloseConfirm}
                  className="rounded-[10px] px-4 py-2 active:bg-surface-raised"
                >
                  <Text className="text-[15px] text-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete"
                  onPress={onConfirmDelete}
                  className="rounded-[10px] bg-danger px-4 py-2 active:opacity-80"
                >
                  <Text className="text-[15px] font-semibold text-accent-foreground">Delete</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View
                accessibilityRole="toolbar"
                accessibilityLabel="Reactions"
                className="flex-row items-center justify-around border-b border-divider px-2 py-2"
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reply"
                onPress={onReply}
                className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
              >
                <Text className="text-[16px] text-foreground">Reply</Text>
              </Pressable>
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit message"
                  onPress={onEdit}
                  className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
                >
                  <Text className="text-[16px] text-foreground">Edit</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy text"
                disabled={!canCopy}
                onPress={onCopy}
                className={cn(
                  'border-b border-divider px-4 py-3.5 active:bg-surface-raised',
                  !canCopy && 'opacity-40',
                )}
              >
                <Text className="text-[16px] text-foreground">Copy text</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete for everyone"
                disabled={!canDelete}
                onPress={onDelete}
                className={cn(
                  'px-4 py-3.5',
                  !canDelete ? 'opacity-40' : 'active:bg-surface-raised',
                  canPin === true ? 'border-b border-divider' : null,
                )}
              >
                <Text className="text-[16px] text-danger">Delete for everyone</Text>
              </Pressable>
              {canPin === true ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPinned === true ? 'Unpin message' : 'Pin message'}
                  onPress={onPin}
                  className="px-4 py-3.5 active:bg-surface-raised"
                >
                  <Text className="text-[16px] text-foreground">
                    {isPinned === true ? 'Unpin' : 'Pin'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
