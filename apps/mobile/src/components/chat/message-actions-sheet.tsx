import type { UiReaction } from '@zilar/chat-core';
import { QUICK_REACTIONS } from '@zilar/chat-core';
import {
  Copy,
  Forward,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCw,
  Trash2,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmojiTab } from '@/components/chat/emoji-tab';
import { tap } from '@/components/chat/haptics';
import { Text } from '@/components/ui/text';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ICON } from '@/lib/colors';
import type { EmojiCategoryId } from '@/lib/emoji-data';
import { cn } from '@/lib/utils';

type MessageActionsSheetProps = {
  visible: boolean;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  // The delete row's label: "Delete" on my own DM message, "Delete for me" on the peer's, "Delete for everyone" in groups.
  deleteLabel: string;
  // The confirm's title when deleting a whole album; undefined keeps the single-message title.
  deleteTitle?: string | undefined;
  ownDelete: boolean;
  dmDelete: boolean;
  senderName: string;
  // A failed own text: Retry and local Delete only; Forward, Edit and Delete-for-everyone are hidden.
  failed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onDeleteLocal?: (() => void) | undefined;
  canForward?: boolean | undefined;
  canPin?: boolean | undefined;
  isPinned?: boolean | undefined;
  myReactions: UiReaction[];
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onForward?: () => void;
  onSelect?: (() => void) | undefined;
  onPin?: () => void;
  // Confirm-delete state, controlled by the parent so the bubble can restore focus on close.
  confirmOpen: boolean;
  onCloseConfirm: () => void;
  onConfirmDelete: () => void;
  onConfirmDeleteForMe: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
};

// Bottom sheet with quick reactions and Reply / Edit / Copy / Delete. In a DM the peer's message offers "Delete for me" with the DM body, my own offers both; in a group it is "Delete for everyone" behind a ConfirmDialog. A failed own text starts with Retry and local Delete instead.
export function MessageActionsSheet({
  visible,
  canCopy,
  canEdit,
  canDelete,
  canReact,
  deleteLabel,
  deleteTitle,
  ownDelete,
  dmDelete,
  senderName,
  failed = false,
  onRetry,
  onDeleteLocal,
  canForward,
  canPin,
  isPinned,
  myReactions,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onForward,
  onSelect,
  onPin,
  confirmOpen,
  onCloseConfirm,
  onConfirmDelete,
  onConfirmDeleteForMe,
  onReact,
  onClose,
}: MessageActionsSheetProps) {
  const myEmojiSet = new Set(myReactions.map((entry) => entry.emoji));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [category, setCategory] = useState<EmojiCategoryId | 'recent' | undefined>('smileys');

  // The parent closes on a pick; reset the grid during render, so a reopen starts on the actions.
  if (!visible && pickerOpen) {
    setPickerOpen(false);
  }

  // `ActionSheet` draws a divider between direct children, and a fragment counts as one, so the rows are a flat array.
  const actions = [
    ...(failed
      ? [
          <ActionSheetItem
            key="retry"
            label="Retry"
            accessibilityLabel="Retry sending message"
            onPress={onRetry ?? (() => {})}
            icon={RotateCw}
          />,
          <ActionSheetItem
            key="delete-local"
            label="Delete"
            accessibilityLabel="Delete unsent message"
            onPress={onDeleteLocal ?? (() => {})}
            destructive
            icon={Trash2}
          />,
        ]
      : []),
    <ActionSheetItem key="reply" label="Reply" onPress={onReply} icon={Reply} />,
    ...(!failed && canForward === true
      ? [
          <ActionSheetItem
            key="forward"
            label="Forward"
            accessibilityLabel="Forward message"
            onPress={onForward ?? (() => {})}
            icon={Forward}
          />,
        ]
      : []),
    ...(!failed && canForward === true && onSelect !== undefined
      ? [
          <ActionSheetItem
            key="select"
            label="Select"
            accessibilityLabel="Select messages"
            onPress={onSelect}
            icon={ListChecks}
          />,
        ]
      : []),
    ...(!failed && canEdit
      ? [
          <ActionSheetItem
            key="edit"
            label="Edit"
            accessibilityLabel="Edit message"
            onPress={onEdit}
            icon={Pencil}
          />,
        ]
      : []),
    <ActionSheetItem
      key="copy"
      label="Copy text"
      onPress={onCopy}
      disabled={!canCopy}
      icon={Copy}
    />,
    ...(!failed
      ? [
          <ActionSheetItem
            key="delete"
            label={deleteLabel}
            accessibilityLabel={deleteLabel}
            onPress={onDelete}
            disabled={!canDelete}
            destructive
            icon={Trash2}
          />,
        ]
      : []),
    ...(canPin === true
      ? [
          <ActionSheetItem
            key="pin"
            label={isPinned === true ? 'Unpin' : 'Pin'}
            accessibilityLabel={isPinned === true ? 'Unpin message' : 'Pin message'}
            onPress={onPin ?? (() => {})}
            icon={isPinned === true ? PinOff : Pin}
          />,
        ]
      : []),
  ];

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
                  accessibilityState={{ selected: mine, disabled: !canReact }}
                  disabled={!canReact}
                  onPress={() => {
                    tap();
                    onReact(emoji);
                  }}
                  className={cn(
                    'h-11 w-11 items-center justify-center rounded-full active:bg-surface-raised',
                    mine ? 'bg-[#ededed]' : null,
                    canReact ? null : 'opacity-40',
                  )}
                >
                  <Text className="text-[20px] leading-[26px]">{emoji}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More reactions"
              accessibilityState={{ disabled: !canReact }}
              disabled={!canReact}
              onPress={() => {
                tap();
                setPickerOpen(true);
              }}
              className={cn(
                'h-11 w-11 items-center justify-center rounded-full active:bg-surface-raised',
                canReact ? null : 'opacity-40',
              )}
            >
              <Plus size={20} color={ICON} />
            </Pressable>
          </View>
        }
      >
        {pickerOpen ? (
          <View className="h-[360px] px-2 py-2">
            <EmojiTab
              open
              recents={[]}
              activeCategory={category}
              onSelectCategory={setCategory}
              onPick={onReact}
            />
          </View>
        ) : (
          actions
        )}
      </ActionSheet>
      {ownDelete ? (
        <ActionSheet
          visible={visible && confirmOpen}
          onClose={onCloseConfirm}
          closeLabel="Cancel delete"
          title={deleteTitle ?? 'Delete message?'}
        >
          <View className="px-4 py-3">
            <Text className="text-[14px] leading-5 text-muted-foreground">
              Delete it for you only, or for everyone in the chat.
            </Text>
          </View>
          <ActionSheetItem
            label="Delete for me"
            accessibilityLabel="Delete for me"
            onPress={onConfirmDeleteForMe}
            destructive
            icon={Trash2}
          />
          <ActionSheetItem
            label="Delete for everyone"
            accessibilityLabel="Delete for everyone"
            onPress={onConfirmDelete}
            destructive
            icon={Trash2}
          />
          <ActionSheetItem
            label="Cancel"
            accessibilityLabel="Cancel delete"
            onPress={onCloseConfirm}
          />
        </ActionSheet>
      ) : dmDelete ? (
        <ConfirmDialog
          visible={visible && confirmOpen}
          title={deleteTitle ?? 'Delete message?'}
          message={`This removes it from your chat only. ${senderName} still has it.`}
          confirmLabel="Delete for me"
          busyLabel="Deleting…"
          busy={false}
          onCancel={onCloseConfirm}
          onConfirm={onConfirmDeleteForMe}
          cancelAccessibilityLabel="Cancel delete"
          confirmAccessibilityLabel="Delete for me"
        />
      ) : (
        <ConfirmDialog
          visible={visible && confirmOpen}
          title={deleteTitle ?? 'Delete for everyone?'}
          message="This deletes it for everyone in the chat."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={false}
          onCancel={onCloseConfirm}
          onConfirm={onConfirmDelete}
          cancelAccessibilityLabel="Cancel delete"
          confirmAccessibilityLabel="Delete"
        />
      )}
    </>
  );
}
