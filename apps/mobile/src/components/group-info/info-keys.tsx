import { Bell, BellOff, MoreHorizontal, Search, Share2, UserPlus } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { rawCall } from '@/components/chat/group-action';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { ICON } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

const MUTE_ERROR = 'Could not update notifications. Try again.';

type InfoKeysProps = {
  /** The group's own chat row: the General topic, the row Mute writes to. */
  groupChatId: string;
  /** Managers (owner/admin) get the Add key, when the screen passes one. */
  canManage: boolean;
  /** The owner gets the More key. */
  isOwner: boolean;
  onSearch: () => void;
  /** Managers only. The channel root omits it, so no Add key shows. */
  onAdd?: (() => void) | undefined;
  /** The channel's Share key: given only when the channel has a handle. */
  onShare?: (() => void) | undefined;
  /** The owner's More key. The channel root omits it until T6. */
  onMore?: (() => void) | undefined;
};

/**
 * The group info keys (T-1552), after `Phone.dc.html`: 40 px `IconButton`
 * keys with a label under each. Mute flips the group's own chat row
 * (`setChatPref`), forever or unmute; a failure shows one line. Add is for
 * managers and More for the owner, so a member sees fewer keys. T-1581 adds
 * the channel's Share key and drops Add when the screen passes none.
 */
export function InfoKeys({
  groupChatId,
  canManage,
  isOwner,
  onSearch,
  onAdd,
  onShare,
  onMore,
}: InfoKeysProps) {
  const setChatPref = useChatStore((state) => state.setChatPref);
  const muted = useChatStore(
    (state) => state.chats.find((chat) => chat.id === groupChatId)?.muted === true,
  );
  const [muteState, runMute] = useAction((mutedUntil: string | null) =>
    rawCall(() => setChatPref(groupChatId, { mutedUntil })),
  );
  const busy = isWaiting(muteState);
  const error = !busy && failureOf(muteState) !== undefined ? MUTE_ERROR : '';

  const toggleMute = () => {
    if (!busy) {
      runMute(muted ? null : mutedUntilFor('forever', new Date()));
    }
  };

  return (
    <View className="px-4 pb-[18px]">
      <View className="flex-row gap-2">
        <InfoKey label={muted ? 'Unmute' : 'Mute'} disabled={busy} onPress={toggleMute}>
          {muted ? <BellOff size={20} color={ICON} /> : <Bell size={20} color={ICON} />}
        </InfoKey>
        <InfoKey label="Search" onPress={onSearch}>
          <Search size={20} color={ICON} />
        </InfoKey>
        {canManage && onAdd !== undefined ? (
          <InfoKey label="Add" onPress={onAdd}>
            <UserPlus size={20} color={ICON} />
          </InfoKey>
        ) : null}
        {onShare !== undefined ? (
          <InfoKey label="Share" onPress={onShare}>
            <Share2 size={20} color={ICON} />
          </InfoKey>
        ) : null}
        {isOwner && onMore !== undefined ? (
          <InfoKey label="More" onPress={onMore}>
            <MoreHorizontal size={20} color={ICON} />
          </InfoKey>
        ) : null}
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="pt-2 text-center text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One labelled key: the 40 px `IconButton` and its 12 px label below. */
function InfoKey({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean | undefined;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View className="flex-1 items-center gap-1.5">
      <IconButton label={label} disabled={disabled} onPress={onPress}>
        {children}
      </IconButton>
      <Text className="text-[12px] text-muted-foreground">{label}</Text>
    </View>
  );
}
