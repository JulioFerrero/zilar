import { formatListTime } from '@zilar/chat-core';
import { Megaphone, Pin } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { Avatar } from '@/components/chat/avatar';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, raisedPill } from '@/lib/depth';
import { channelSubscriberLabel } from '@/lib/channels';
import { previewParts } from '@/lib/format';
import { groupRowFor, topicCountLabel, topicsOfGroup } from '@/lib/topics';
import { CURRENT_USER_ID } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

function GroupUnreadBadge({ count, muted }: { count: number; muted: boolean }) {
  return (
    <View
      // A fresh view per look: RN 0.86 on Android crashes in draw when a live
      // view swaps one gradient style for another (device report 2026-10-04).
      key={muted ? 'muted' : 'live'}
      style={muted ? raisedPill : primaryKey}
      className="h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5"
    >
      <Text
        className={cn(
          'text-[12px] font-semibold',
          muted ? 'text-foreground' : 'text-accent-foreground',
        )}
      >
        {count}
      </Text>
    </View>
  );
}

/**
 * One group row on the chat list (T-0112): title, "N topics", the aggregated
 * unread, the newest message time and the last topic's preview
 * ("Dev AI: Preview ready"). Tapping opens the topics screen. A group
 * without topics from an older server keeps its `ChatListItem` row as today.
 */
export function GroupListItem({
  groupId,
  onPress,
  onLongPress,
}: {
  groupId: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const chats = useChatStore((state) => state.chats);
  const row = groupRowFor(groupId, topicsOfGroup(chats, groupId));
  if (row === undefined) {
    return null;
  }
  const newest = row.topics.reduce<(typeof row.topics)[number] | undefined>(
    (best, chat) =>
      (chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY) >
      (best?.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY)
        ? chat
        : best,
    undefined,
  );
  const last = newest?.lastMessage;
  // The preview names the topic's last sender ("Dev AI: Preview ready").
  const preview = previewParts(last?.deleted === true ? undefined : last, {
    isGroup: true,
    currentUserId: CURRENT_USER_ID,
  });
  const body =
    last === undefined ? '' : plainPreviewBody(newest!, last, preview.body, CURRENT_USER_ID);
  const subtitle =
    row.chatKind === 'channel'
      ? channelSubscriberLabel(row.subscriberCount ?? row.memberCount ?? 0)
      : topicCountLabel(row.topicCount);
  const anyPinned = row.topics.some((topic) => topic.pinnedAt !== undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${subtitle}`}
      onPress={onPress}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      className="h-[76px] flex-row items-center bg-background pl-4 active:bg-surface-raised"
    >
      <Avatar id={groupId} name={row.title} size={52} />
      <View className="ml-3 h-full flex-1 flex-row items-center border-b border-[#1a1a1a] pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-baseline gap-1.5">
              <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
                {row.title}
              </Text>
              {row.chatKind === 'channel' ? (
                <View accessibilityRole="image" accessibilityLabel="Channel">
                  <Megaphone size={14} color={MUTED_FOREGROUND[scheme]} />
                </View>
              ) : null}
              {anyPinned ? (
                <View accessibilityRole="image" accessibilityLabel="Pinned chat">
                  <Pin size={14} color={MUTED_FOREGROUND[scheme]} />
                </View>
              ) : null}
              <Text numberOfLines={1} className="shrink-0 text-[12px] text-subtle-foreground">
                {subtitle}
              </Text>
            </View>
            {row.newestAt ? (
              <Text className="ml-2 shrink-0 font-mono text-[12px] text-subtle-foreground">
                {formatListTime(row.newestAt, new Date())}
              </Text>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center justify-between">
            <Text numberOfLines={1} className="mr-2 flex-1 text-[14px] text-muted-foreground">
              {preview.prefix ? <Text color="#d4d4d4">{preview.prefix}</Text> : null}
              {body}
            </Text>
            {row.unread > 0 ? <GroupUnreadBadge count={row.unread} muted={row.muted} /> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
