import { Archive, Bell, BellOff, Pin, PinOff } from 'lucide-react-native';

import { ActionSheet, ActionSheetItem } from '../ui/action-sheet';
import { MUTE_DURATIONS, type MuteDurationId } from '../../lib/chat-prefs';
import type { ChatSummary } from '../../lib/types';

/**
 * The long-press action sheet on a chat or group row (T-0135): Pin/Unpin,
 * Mute (1 hour, 8 hours, 1 day, 1 week, Forever, Unmute), Archive/Unarchive,
 * plus "Open group" for a group row (T-0139: the way to the group screen
 * with invite links, roles and members). Pure view (no hooks) so it stays
 * render-testable like `ReactionChips`: the screen owns the mute submenu
 * and performs the pref writes. For a group row the caller passes the
 * General topic row (plus the group title and id for the header and the
 * "Open group" row), so a group mute sits on the General JID and applies
 * to every topic of the group. Without a General row the pref rows stay
 * disabled — a group pref on a non-General JID would hit one topic, not
 * the group — while "Open group" stays enabled.
 */
export function ChatActionsSheet({
  chat,
  groupTitle,
  groupId,
  busy,
  error,
  muteOpen,
  onOpenMute,
  onMute,
  onUnmute,
  onTogglePin,
  onToggleArchive,
  onOpenGroup,
  onClose,
}: {
  chat: ChatSummary | null;
  /** Set for a group row: the sheet titles itself from the group. */
  groupTitle?: string | undefined;
  /** Set for a group row: shows "Open group" to reach the group screen. */
  groupId?: string | undefined;
  busy: boolean;
  error: string;
  muteOpen: boolean;
  onOpenMute: () => void;
  onMute: (duration: MuteDurationId) => void;
  onUnmute: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onOpenGroup?: ((groupId: string) => void) | undefined;
  onClose: () => void;
}) {
  const pinned = chat?.pinnedAt !== undefined;
  const archived = chat?.archived === true;
  const muted = chat?.muted === true;
  const title = groupTitle ?? chat?.title ?? '';
  const ready = chat !== null;

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
          label={muted ? 'Muted: change' : 'Mute'}
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
      {groupId !== undefined && onOpenGroup !== undefined ? (
        <ActionSheetItem
          label="Open group"
          accessibilityLabel="Open group"
          disabled={busy}
          onPress={() => onOpenGroup(groupId)}
        />
      ) : null}
    </ActionSheet>
  );
}
