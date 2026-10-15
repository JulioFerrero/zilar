import { Bot, ChevronLeft, Link2, LogOut, Megaphone, Users } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { InfoKeys } from '@/components/group-info/info-keys';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { channelSubscriberLabel } from '@/lib/channels';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

type ChannelInfoRootProps = {
  /** The channel's feed chat row: the picture, Mute and the Feed row. */
  feedId: string;
  title: string;
  avatarUrl: string | undefined;
  /** The public `@handle`, or `null` while the channel has none. */
  handle: string | null;
  subscriberCount: number;
  description: string | null;
  /** The channel's AIs, for the AIs row; `undefined` when not loaded. */
  aisCount: number | undefined;
  /** The last feed message, or `undefined`: the Feed row's second line. */
  feedPreview: string | undefined;
  isManager: boolean;
  /** A subscriber: show the red Leave channel row. */
  canLeave: boolean;
  /** The leave call is in flight. */
  leaving: boolean;
  /** The leave call failed: a plain message under the row. */
  leaveError: string;
  onBack: () => void;
  onSearch: () => void;
  /** Given only when the channel has a handle. */
  onShare: (() => void) | undefined;
  onOpenFeed: () => void;
  onOpenPeople: () => void;
  onOpenAis: () => void;
  onOpenLinks: () => void;
  onLeave: () => void;
};

/**
 * The channel info root page (T-1581), after `WebChannel.dc.html`: a back key,
 * the channel picture, name and `@handle · N subscribers` line and the
 * description, then the Mute / Search / Share keys, the Feed row, the People
 * group (Admins and subscribers, AIs, Invite links for managers) and the red
 * Leave channel row for non-owners. Thin view: `channel-screen.tsx` owns the
 * data and the sheets. More arrives with T6.
 */
export function ChannelInfoRoot({
  feedId,
  title,
  avatarUrl,
  handle,
  subscriberCount,
  description,
  aisCount,
  feedPreview,
  isManager,
  canLeave,
  leaving,
  leaveError,
  onBack,
  onSearch,
  onShare,
  onOpenFeed,
  onOpenPeople,
  onOpenAis,
  onOpenLinks,
  onLeave,
}: ChannelInfoRootProps) {
  const subscribers = channelSubscriberLabel(subscriberCount);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="items-center gap-1.5 px-4 pb-[18px]">
          <EntityAvatar chat={{ id: feedId, title, avatarUrl }} size={96} />
          <View className="mt-2 max-w-full flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="text-[22px] font-semibold tracking-[-0.02em] text-foreground"
            >
              {title}
            </Text>
            <View accessibilityRole="image" accessibilityLabel="Channel">
              <Megaphone size={18} color={MUTED_FOREGROUND} />
            </View>
          </View>
          <Text className="text-[14px] text-muted-foreground">
            {handle === null ? subscribers : `@${handle} · ${subscribers}`}
          </Text>
          {description === null || description === '' ? null : (
            <Text className="mt-1 max-w-full text-center text-[14px] text-muted-foreground">
              {description}
            </Text>
          )}
        </View>

        <InfoKeys
          groupChatId={feedId}
          canManage={isManager}
          // More is the owner's key and arrives with T6, so the channel root
          // passes no owner key yet.
          isOwner={false}
          onSearch={onSearch}
          onShare={onShare}
        />

        <View className="gap-3 px-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open the ${title} feed`}
            onPress={onOpenFeed}
            className="flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3 active:bg-surface-raised"
          >
            <EntityAvatar chat={{ id: feedId, title, avatarUrl }} size={40} />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
                Feed
              </Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {feedPreview ?? 'Open the feed'}
              </Text>
            </View>
          </Pressable>

          <InfoRowGroup>
            <InfoRow
              icon={Users}
              label="Admins and subscribers"
              count={subscriberCount}
              onPress={onOpenPeople}
            />
            <InfoRow icon={Bot} label="AIs" count={aisCount} onPress={onOpenAis} />
            {isManager ? <InfoRow icon={Link2} label="Invite links" onPress={onOpenLinks} /> : null}
          </InfoRowGroup>

          {canLeave ? (
            <View className="gap-1">
              <InfoRowGroup>
                <InfoRow icon={LogOut} label="Leave channel" danger onPress={onLeave} />
              </InfoRowGroup>
              {leaving || leaveError !== '' ? (
                <Text accessibilityRole="alert" className="px-3 text-[13px] text-danger">
                  {leaving ? 'Leaving…' : leaveError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
