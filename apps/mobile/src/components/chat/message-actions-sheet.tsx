import type { UiReaction } from '@zilar/chat-core';
import { QUICK_REACTIONS } from '@zilar/chat-core';
import {
  Copy,
  Forward,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Reply,
  RotateCw,
  Trash2,
} from 'lucide-react-native';
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
  /**
   * The row label for the delete action (T-1247, the web's labels): "Delete" on
   * my own DM message, "Delete for me" on the peer's, "Delete for everyone" in
   * groups.
   */
  deleteLabel: string;
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
 * Delete. In a group the delete row is "Delete for everyone" behind a kit
 * `ConfirmDialog`. In a DM (T-1247) the peer's message offers "Delete for me"
 * with the DM body, and my own offers both choices in an in-sheet confirm. The
 * parent just toggles `confirmOpen`. A failed own text instead starts with
 * Retry and (local-only, no-confirm) Delete, and hides Forward, Edit and
 * Delete.
 */
export function MessageActionsSheet({
  visible,
  canCopy,
  canEdit,
  canDelete,
  deleteLabel,
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
        {failed ? (
          <>
            <ActionSheetItem
              label="Retry"
              accessibilityLabel="Retry sending message"
              onPress={onRetry ?? (() => {})}
              icon={RotateCw}
            />
            <ActionSheetItem
              label="Delete"
              accessibilityLabel="Delete unsent message"
              onPress={onDeleteLocal ?? (() => {})}
              destructive
              icon={Trash2}
            />
          </>
        ) : null}
        <ActionSheetItem label="Reply" onPress={onReply} icon={Reply} />
        {!failed && canForward === true ? (
          <ActionSheetItem
            label="Forward"
            accessibilityLabel="Forward message"
            onPress={onForward ?? (() => {})}
            icon={Forward}
          />
        ) : null}
        {!failed && canForward === true && onSelect !== undefined ? (
          <ActionSheetItem
            label="Select"
            accessibilityLabel="Select messages"
            onPress={onSelect}
            icon={ListChecks}
          />
        ) : null}
        {!failed && canEdit ? (
          <ActionSheetItem
            label="Edit"
            accessibilityLabel="Edit message"
            onPress={onEdit}
            icon={Pencil}
          />
        ) : null}
        <ActionSheetItem label="Copy text" onPress={onCopy} disabled={!canCopy} icon={Copy} />
        {!failed ? (
          <ActionSheetItem
            label={deleteLabel}
            accessibilityLabel={deleteLabel}
            onPress={onDelete}
            disabled={!canDelete}
            destructive
            icon={Trash2}
          />
        ) : null}
        {canPin === true ? (
          <ActionSheetItem
            label={isPinned === true ? 'Unpin' : 'Pin'}
            accessibilityLabel={isPinned === true ? 'Unpin message' : 'Pin message'}
            onPress={onPin ?? (() => {})}
            icon={isPinned === true ? PinOff : Pin}
          />
        ) : null}
      </ActionSheet>
      {ownDelete ? (
        <ActionSheet
          visible={visible && confirmOpen}
          onClose={onCloseConfirm}
          closeLabel="Cancel delete"
          title="Delete message?"
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
          title="Delete message?"
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
      )}
    </>
  );
}
