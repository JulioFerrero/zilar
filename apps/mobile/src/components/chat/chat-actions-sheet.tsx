import {
  Archive,
  Bell,
  BellOff,
  Eraser,
  Mail,
  MailOpen,
  Pin,
  PinOff,
  Users,
} from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '../ui/text';
import { ActionSheet, ActionSheetItem } from '../ui/action-sheet';
import { MUTE_DURATIONS } from '@zilar/chat-core';
import type { MuteDurationId, ChatSummary } from '@zilar/chat-core';

/** Pure view: the screen owns the mute submenu and the pref writes. Group
 *  prefs sit on the General JID, so a mute covers every topic. */
export function ChatActionsSheet({
  chat,
  groupTitle,
  groupId,
  busy,
  error,
  muteOpen,
  clearOpen,
  onOpenMute,
  onMute,
  onUnmute,
  onTogglePin,
  onToggleArchive,
  onMarkUnread,
  onMarkRead,
  onOpenClear,
  onClearHistory,
  onCancelClear,
  onOpenGroup,
  onClose,
}: {
  chat: ChatSummary | null;
  groupTitle?: string | undefined;
  groupId?: string | undefined;
  busy: boolean;
  error: string;
  muteOpen: boolean;
  clearOpen: boolean;
  onOpenMute: () => void;
  onMute: (duration: MuteDurationId) => void;
  onUnmute: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onMarkUnread: () => void;
  onMarkRead: () => void;
  onOpenClear: () => void;
  onClearHistory: () => void;
  onCancelClear: () => void;
  onOpenGroup?: ((groupId: string) => void) | undefined;
  onClose: () => void;
}) {
  const pinned = chat?.pinnedAt !== undefined;
  const archived = chat?.archived === true;
  const muted = chat?.muted === true;
  const marked = chat?.unreadMark === true;
  const showMarkRead = (chat?.unread ?? 0) > 0 || marked;
  const title = groupTitle ?? chat?.title ?? '';
  const ready = chat !== null;
  const isDm = chat?.kind === 'dm' && chat.isAI !== true;

  if (clearOpen) {
    return (
      <ActionSheet
        visible
        onClose={onCancelClear}
        closeLabel="Cancel clear history"
        title="Clear history?"
        error={error}
      >
        <View className="px-4 py-3">
          <Text className="text-[14px] leading-5 text-muted-foreground">
            {`Clear your history with ${title}? This removes every message from your side only. ${title} keeps theirs.`}
          </Text>
        </View>
        <ActionSheetItem
          label="Clear history"
          accessibilityLabel="Clear history"
          disabled={busy}
          onPress={onClearHistory}
          destructive
          icon={Eraser}
        />
        <ActionSheetItem
          label="Cancel"
          accessibilityLabel="Cancel clear history"
          disabled={busy}
          onPress={onCancelClear}
        />
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      visible={ready || groupTitle !== undefined}
      onClose={onClose}
      closeLabel="Close chat actions"
      title={title}
      error={error}
    >
      <ActionSheetItem
        label={pinned ? 'Unpin' : 'Pin'}
        accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
        disabled={busy || !ready}
        onPress={onTogglePin}
        icon={pinned ? PinOff : Pin}
      />
      {muteOpen ? (
        MUTE_DURATIONS.map((option) => (
          <ActionSheetItem
            key={option.id}
            label={option.label}
            accessibilityLabel={`Mute for ${option.label.toLowerCase()}`}
            disabled={busy || !ready}
            onPress={() => onMute(option.id)}
            inset
          />
        ))
      ) : (
        <ActionSheetItem
          label={muted ? 'Muted · Change' : 'Mute'}
          accessibilityLabel={muted ? 'Change mute' : 'Mute chat'}
          disabled={busy || !ready}
          onPress={onOpenMute}
          icon={muted ? BellOff : Bell}
        />
      )}
      {muteOpen && muted ? (
        <ActionSheetItem
          label="Unmute"
          accessibilityLabel="Unmute chat"
          disabled={busy || !ready}
          onPress={onUnmute}
          inset
        />
      ) : null}
      <ActionSheetItem
        label={archived ? 'Unarchive' : 'Archive'}
        accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
        disabled={busy || !ready}
        onPress={onToggleArchive}
        icon={Archive}
      />
      {showMarkRead ? (
        <ActionSheetItem
          label="Mark as read"
          accessibilityLabel="Mark chat as read"
          disabled={busy || !ready}
          onPress={onMarkRead}
          icon={MailOpen}
        />
      ) : (
        <ActionSheetItem
          label="Mark as unread"
          accessibilityLabel="Mark chat as unread"
          disabled={busy || !ready}
          onPress={onMarkUnread}
          icon={Mail}
        />
      )}
      {isDm ? (
        <ActionSheetItem
          label="Clear history"
          accessibilityLabel="Clear history"
          disabled={busy || !ready}
          onPress={onOpenClear}
          icon={Eraser}
        />
      ) : null}
      {groupId !== undefined && onOpenGroup !== undefined ? (
        <ActionSheetItem
          label="Open group"
          accessibilityLabel="Open group"
          disabled={busy}
          onPress={() => onOpenGroup(groupId)}
          icon={Users}
        />
      ) : null}
    </ActionSheet>
  );
}
