import { Archive, Bell, BellOff, Pin, PinOff } from 'lucide-react-native';
import { Modal, Pressable, View } from 'react-native';

import { Text } from '../ui/text';
import { MUTE_DURATIONS, type MuteDurationId } from '../../lib/chat-prefs';
import type { ChatSummary } from '../../lib/types';
import { cn } from '../../lib/utils';

/**
 * The long-press action sheet on a chat or group row (T-0135): Pin/Unpin,
 * Mute (1 hour, 8 hours, 1 day, 1 week, Forever, Unmute), Archive/Unarchive,
 * plus "Open group" for a group row (T-0139: the way to the group screen
 * with invite links, roles and members). Pure view (no hooks) so it stays
 * render-testable like `ReactionChips`: the screen owns the mute submenu
 * and performs the pref writes. For a group row the caller passes the
 * General topic row (plus the group title for the header), so a group mute
 * sits on the General JID and applies to every topic of the group.
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
    <Modal
      visible={ready || groupTitle !== undefined}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="Close chat actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: 16 }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          <View className="border-b border-divider px-4 py-3">
            <Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">
              {title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
            disabled={busy || !ready}
            onPress={onTogglePin}
            className="flex-row items-center gap-3 border-b border-divider px-4 py-3.5 active:bg-surface-raised disabled:opacity-50"
          >
            {pinned ? <PinOff size={18} color="#8a8a8a" /> : <Pin size={18} color="#8a8a8a" />}
            <Text className="text-[16px] text-foreground">{pinned ? 'Unpin' : 'Pin'}</Text>
          </Pressable>
          {muteOpen ? (
            <>
              {MUTE_DURATIONS.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Mute for ${option.label.toLowerCase()}`}
                  disabled={busy || !ready}
                  onPress={() => onMute(option.id)}
                  className="border-b border-divider px-4 py-3 active:bg-surface-raised disabled:opacity-50"
                >
                  <Text className="pl-9 text-[16px] text-foreground">{option.label}</Text>
                </Pressable>
              ))}
              {muted ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Unmute chat"
                  disabled={busy || !ready}
                  onPress={onUnmute}
                  className="border-b border-divider px-4 py-3 active:bg-surface-raised disabled:opacity-50"
                >
                  <Text className="pl-9 text-[16px] text-foreground">Unmute</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={muted ? 'Change mute' : 'Mute chat'}
              disabled={busy || !ready}
              onPress={onOpenMute}
              className="flex-row items-center gap-3 border-b border-divider px-4 py-3.5 active:bg-surface-raised disabled:opacity-50"
            >
              {muted ? <BellOff size={18} color="#8a8a8a" /> : <Bell size={18} color="#8a8a8a" />}
              <Text className="text-[16px] text-foreground">
                {muted ? 'Muted: change' : 'Mute'}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
            disabled={busy || !ready}
            onPress={onToggleArchive}
            className={cn(
              'flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-raised disabled:opacity-50',
              error === '' && onOpenGroup === undefined ? null : 'border-b border-divider',
            )}
          >
            <Archive size={18} color="#8a8a8a" />
            <Text className="text-[16px] text-foreground">
              {archived ? 'Unarchive' : 'Archive'}
            </Text>
          </Pressable>
          {groupId !== undefined && onOpenGroup !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open group"
              disabled={busy}
              onPress={() => onOpenGroup(groupId)}
              className={cn(
                'flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-raised disabled:opacity-50',
                error === '' ? null : 'border-b border-divider',
              )}
            >
              <Text className="text-[16px] text-foreground">Open group</Text>
            </Pressable>
          ) : null}
          {error !== '' ? (
            <View className="px-4 py-2">
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {error}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
