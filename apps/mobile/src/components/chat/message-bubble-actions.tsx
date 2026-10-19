import { canAct, QUICK_REACTIONS, type UiMessage, type UiReaction } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Clipboard from 'expo-clipboard';
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

import { systemConfirmsCopy, useChatNotice } from '@/components/chat/chat-notice-context';
import { EmojiTab } from '@/components/chat/emoji-tab';
import { tap } from '@/components/chat/haptics';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';
import type { EmojiCategoryId } from '@zilar/chat-core';

// The message a bubble hands to the one menu: the flags and reactions travel with it, so the sheet reads no store.
export type BubbleActionsTarget = {
  message: UiMessage;
  albumMembers?: UiMessage[] | undefined;
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
};

type BubbleActionsSheetProps = BubbleActionsTarget & {
  visible: boolean;
  confirmOpen: boolean;
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

// Bottom sheet with quick reactions and Reply / Edit / Copy / Delete. In a DM the peer's message offers "Delete for me" with the DM body, my own offers both; in a group it is "Delete for everyone" behind a ConfirmDialog. A failed own text starts with Retry and local Delete instead.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [category, setCategory] = useState<EmojiCategoryId | 'recent' | undefined>('smileys');
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
  const deleteLabel = isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone';
  const myEmojiSet = new Set(myReactions.map((entry) => entry.emoji));
  const closeConfirm = () => setConfirmOpen(false);
  const reactTo = (emoji: string) => {
    setMenuOpen(false);
    react(message, emoji);
  };
  const retry = () => {
    setMenuOpen(false);
    retryText(message.chatId, message.id);
  };
  const deleteLocal = () => {
    setMenuOpen(false);
    deleteFailedMessage(message.chatId, message.id);
  };
  const reply = () => {
    setMenuOpen(false);
    onReply(message);
  };
  const edit = () => {
    setMenuOpen(false);
    onEdit?.(message);
  };
  const copy = () => {
    setMenuOpen(false);
    copyMessageText(message.text ?? '');
    if (!systemConfirmsCopy()) {
      notify('Copied');
    }
  };
  const confirmDelete = () => {
    setConfirmOpen(false);
    setMenuOpen(false);
    for (const target of deleteTargets) {
      onDelete?.(target);
    }
  };
  const confirmDeleteForMe = () => {
    setConfirmOpen(false);
    setMenuOpen(false);
    for (const target of deleteTargets) {
      void deleteForMe(target.chatId, target.id);
    }
  };

  // The parent closes on a pick; reset the grid during render, so a reopen starts on the actions.
  if (!visible && pickerOpen) {
    setPickerOpen(false);
  }

  // `ActionSheet` draws a divider between direct children, and a fragment counts as one, so the rows are a flat array.
  const actions = [
    ...(failedText
      ? [
          <ActionSheetItem
            key="retry"
            label="Retry"
            accessibilityLabel="Retry sending message"
            onPress={retry}
            icon={RotateCw}
          />,
          <ActionSheetItem
            key="delete-local"
            label="Delete"
            accessibilityLabel="Delete unsent message"
            onPress={deleteLocal}
            destructive
            icon={Trash2}
          />,
        ]
      : []),
    <ActionSheetItem key="reply" label="Reply" onPress={reply} icon={Reply} />,
    ...(!failedText && canForward
      ? [
          <ActionSheetItem
            key="forward"
            label="Forward"
            accessibilityLabel="Forward message"
            onPress={() => {
              setMenuOpen(false);
              onForward?.(message);
            }}
            icon={Forward}
          />,
        ]
      : []),
    ...(!failedText && canForward && onStartSelect !== undefined
      ? [
          <ActionSheetItem
            key="select"
            label="Select"
            accessibilityLabel="Select messages"
            onPress={() => {
              setMenuOpen(false);
              onStartSelect(message);
            }}
            icon={ListChecks}
          />,
        ]
      : []),
    ...(!failedText && canEdit && canActNow
      ? [
          <ActionSheetItem
            key="edit"
            label="Edit"
            accessibilityLabel="Edit message"
            onPress={edit}
            icon={Pencil}
          />,
        ]
      : []),
    <ActionSheetItem key="copy" label="Copy text" onPress={copy} disabled={!canCopy} icon={Copy} />,
    ...(!failedText
      ? [
          <ActionSheetItem
            key="delete"
            label={deleteLabel}
            accessibilityLabel={deleteLabel}
            onPress={() => setConfirmOpen(true)}
            disabled={!(canDelete || canDeleteForMe) || !canActNow}
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
            onPress={() => {
              setMenuOpen(false);
              if (isPinned === true) {
                onUnpin?.(message);
              } else {
                onPin?.(message);
              }
            }}
            icon={isPinned === true ? PinOff : Pin}
          />,
        ]
      : []),
  ];

  return (
    <>
      <ActionSheet
        visible={visible && !confirmOpen}
        onClose={onMenuClosed}
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
                  accessibilityState={{ selected: mine, disabled: !canActNow }}
                  disabled={!canActNow}
                  onPress={() => {
                    tap();
                    reactTo(emoji);
                  }}
                  className={cn(
                    'h-11 w-11 items-center justify-center rounded-full active:bg-surface-raised',
                    mine ? 'bg-[#ededed]' : null,
                    canActNow ? null : 'opacity-40',
                  )}
                >
                  <Text className="text-[20px] leading-[26px]">{emoji}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More reactions"
              accessibilityState={{ disabled: !canActNow }}
              disabled={!canActNow}
              onPress={() => {
                tap();
                setPickerOpen(true);
              }}
              className={cn(
                'h-11 w-11 items-center justify-center rounded-full active:bg-surface-raised',
                canActNow ? null : 'opacity-40',
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
              onPick={reactTo}
            />
          </View>
        ) : (
          actions
        )}
      </ActionSheet>
      {isDm && own ? (
        <ActionSheet
          visible={visible && confirmOpen}
          onClose={closeConfirm}
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
            onPress={confirmDeleteForMe}
            destructive
            icon={Trash2}
          />
          <ActionSheetItem
            label="Delete for everyone"
            accessibilityLabel="Delete for everyone"
            onPress={confirmDelete}
            destructive
            icon={Trash2}
          />
          <ActionSheetItem
            label="Cancel"
            accessibilityLabel="Cancel delete"
            onPress={closeConfirm}
          />
        </ActionSheet>
      ) : isDm ? (
        <ConfirmDialog
          visible={visible && confirmOpen}
          title={deleteTitle ?? 'Delete message?'}
          message={`This removes it from your chat only. ${senderName} still has it.`}
          confirmLabel="Delete for me"
          busyLabel="Deleting…"
          busy={false}
          onCancel={closeConfirm}
          onConfirm={confirmDeleteForMe}
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
          onCancel={closeConfirm}
          onConfirm={confirmDelete}
          cancelAccessibilityLabel="Cancel delete"
          confirmAccessibilityLabel="Delete"
        />
      )}
    </>
  );
}
