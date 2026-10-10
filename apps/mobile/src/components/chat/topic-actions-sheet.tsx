import { Lock } from 'lucide-react-native';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Text } from '@/components/ui/text';
import { MUTE_DURATIONS, type MuteDurationId } from '@/lib/chat-prefs';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ChatSummary } from '@/lib/types';

export type TopicSheetAction = 'archive';
export type TopicPrefAction =
  | { kind: 'mute'; duration: MuteDurationId }
  | { kind: 'unmute' }
  | { kind: 'pin'; pinned: boolean }
  | { kind: 'archive'; archived: boolean };

/**
 * The long-press sheet on a topic row (T-0112, extended in T-0135): Pin /
 * Unpin, Mute with the durations (Unmute when muted), Archive chat /
 * Unarchive for the per-user archive, plus Archive topic for everyone for
 * managers (never General — the caller hides it). Pure view (no hooks) so
 * it stays render-testable like `ReactionChips`: the screen owns the mute
 * submenu and performs the actions.
 */
export function TopicActionsSheet({
  chat,
  canArchive,
  muteOpen,
  onOpenMute,
  onAction,
  onPref,
  onClose,
}: {
  chat: ChatSummary | null;
  canArchive: boolean;
  muteOpen: boolean;
  onOpenMute: () => void;
  onAction: (action: TopicSheetAction) => void;
  onPref: (action: TopicPrefAction) => void;
  onClose: () => void;
}) {
  const pinned = chat?.pinnedAt !== undefined;
  const archived = chat?.archived === true;
  const muted = chat?.muted === true;
  return (
    <ActionSheet
      visible={chat !== null}
      onClose={onClose}
      closeLabel="Close topic actions"
      header={
        chat !== null ? (
          <View className="flex-row items-center gap-3 px-4 py-3">
            <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-edge bg-surface-raised">
              <Text className="text-[16px] font-semibold text-foreground">
                {chat.topic?.glyph ?? 'G'}
              </Text>
            </View>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
              {chat.title}
            </Text>
            {chat.topic?.visibility === 'private' ? (
              <Lock size={16} color={MUTED_FOREGROUND} />
            ) : null}
          </View>
        ) : undefined
      }
    >
      <ActionSheetItem
        label={pinned ? 'Unpin' : 'Pin'}
        accessibilityLabel={pinned ? 'Unpin topic' : 'Pin topic'}
        onPress={() => onPref({ kind: 'pin', pinned: !pinned })}
      />
      {muteOpen ? (
        <>
          {MUTE_DURATIONS.map((option) => (
            <ActionSheetItem
              key={option.id}
              label={option.label}
              accessibilityLabel={`Mute for ${option.label.toLowerCase()}`}
              onPress={() => onPref({ kind: 'mute', duration: option.id })}
            />
          ))}
          {muted ? (
            <ActionSheetItem
              label="Unmute"
              accessibilityLabel="Unmute topic"
              onPress={() => onPref({ kind: 'unmute' })}
            />
          ) : null}
        </>
      ) : (
        <ActionSheetItem
          label={muted ? 'Muted: change' : 'Mute'}
          accessibilityLabel="Mute topic"
          onPress={onOpenMute}
        />
      )}
      <ActionSheetItem
        label={archived ? 'Unarchive' : 'Archive'}
        accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
        onPress={() => onPref({ kind: 'archive', archived: !archived })}
      />
      {canArchive ? (
        <ActionSheetItem
          label="Archive topic for everyone"
          accessibilityLabel="Archive topic for everyone"
          onPress={() => onAction('archive')}
          destructive
        />
      ) : null}
    </ActionSheet>
  );
}
