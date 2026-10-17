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
  /** True when the message can be named on the wire for a reaction (UI-7). */
  canReact: boolean;
  /**
   * The row label for the delete action (T-1247, the web's labels): "Delete" on
   * my own DM message, "Delete for me" on the peer's, "Delete for everyone" in
   * groups.
   */
  deleteLabel: string;
  /**
   * T-1274: the confirm's title when the delete acts on a whole album
   * ("Delete album?"); undefined keeps the single-message title.
   */
  deleteTitle?: string | undefined;
  /** T-1247: my own message in a DM, where the confirm offers both choices. */
  ownDelete: boolean;
  /** T-1247: a DM delete, which uses the DM confirms instead of the group one. */
  dmDelete: boolean;
  /** The peer's name, for the DM confirm body. */
  senderName: string;
  /** A failed own text: the sheet starts with Retry and Delete (local only),
   *  and hides Forward, Edit and Delete-for-everyone. */
  failed?: boolean | undefined;
  /** Retry a failed text send (undefined hides the row). */
  onRetry?: (() => void) | undefined;
  /** Delete a failed send locally, with no confirm (undefined hides the row). */
  onDeleteLocal?: (() => void) | undefined;
  /** Forward for a forwardable message (undefined/false hides the row). */
  canForward?: boolean | undefined;
  /** Pin/Unpin for those allowed (undefined hides the row). */
  canPin?: boolean | undefined;
  isPinned?: boolean | undefined;
  /** My current reactions, so a chip I already reacted with is highlighted. */
  myReactions: UiReaction[];
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onForward?: () => void;
  /** Enters select mode for this message (undefined hides the row). */
  onSelect?: (() => void) | undefined;
  onPin?: () => void;
  /** Confirm-delete dialog state, controlled by the parent so the bubble can
   *  restore focus on close. */
  confirmOpen: boolean;
  onCloseConfirm: () => void;
  /** The confirm's "Delete for everyone" action. */
  onConfirmDelete: () => void;
  /** The confirm's "Delete for me" action (T-1247). */
  onConfirmDeleteForMe: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
};

/**
 * Bottom sheet with the quick-reaction bar and Reply / Edit / Copy text /
 * Delete. The bar's last key opens the full emoji grid in place of the
 * actions, so any emoji can be a reaction (T-1932). In a group the delete row
 * is "Delete for everyone" behind a kit `ConfirmDialog`. In a DM (T-1247) the
 * peer's message offers "Delete for me" with the DM body, and my own offers
 * both choices in an in-sheet confirm. The parent just toggles `confirmOpen`.
 * A failed own text instead starts with Retry and (local-only, no-confirm)
 * Delete, and hides Forward, Edit and Delete.
 */
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

  // The parent closes the sheet on a pick; reset the grid during render, so a
  // reopen starts on the actions and no effect synchronizes state.
  if (!visible && pickerOpen) {
    setPickerOpen(false);
  }

  // `ActionSheet` draws a divider between its direct children, and a fragment
  // counts as one child, so the rows are a flat array.
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
