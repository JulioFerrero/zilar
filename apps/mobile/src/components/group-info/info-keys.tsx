import { Bell, BellOff, MoreHorizontal, Search, Share2, UserPlus } from 'lucide-react-native';
import { View } from 'react-native';

import { rawCall } from '@/components/chat/group-action';
import { ActionTiles, type ActionTile } from '@/components/ui/action-tiles';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

const MUTE_ERROR = 'Could not update notifications. Try again.';

type InfoKeysProps = {
  groupChatId: string;
  canManage: boolean;
  isOwner: boolean;
  onSearch: () => void;
  onAdd?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  onMore?: (() => void) | undefined;
};

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

  const items: ActionTile[] = [
    {
      key: 'mute',
      label: muted ? 'Unmute' : 'Mute',
      icon: muted ? BellOff : Bell,
      onPress: toggleMute,
      disabled: busy,
    },
    { key: 'search', label: 'Search', icon: Search, onPress: onSearch },
  ];
  if (canManage && onAdd !== undefined) {
    items.push({ key: 'add', label: 'Add', icon: UserPlus, onPress: onAdd });
  }
  if (onShare !== undefined) {
    items.push({ key: 'share', label: 'Share', icon: Share2, onPress: onShare });
  }
  if (isOwner && onMore !== undefined) {
    items.push({ key: 'more', label: 'More', icon: MoreHorizontal, onPress: onMore });
  }

  return (
    <View className="px-4 pb-[18px]">
      <ActionTiles items={items} />
      {error !== '' ? (
        <Text accessibilityRole="alert" className="pt-2 text-center text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
