import { formatListTime, previewMessage, previewParts } from '@zilar/chat-core';
import { Megaphone, Pin } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { PreviewIcon } from '@/components/chat/preview-icon';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { Text } from '@/components/ui/text';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { channelSubscriberLabel } from '@/lib/channels';
import { useBlockedJids } from '@/lib/blocked-users';
import { groupRowFor, topicCountLabel, topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';

export function GroupListItem({
  groupId,
  onPress,
  onLongPress,
}: {
  groupId: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const chats = useChatStore((state) => state.chats);
  const row = groupRowFor(groupId, topicsOfGroup(chats, groupId));
  const topics = row?.topics ?? [];
  const newest = topics.reduce<(typeof topics)[number] | undefined>(
    (best, chat) =>
      (chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY) >
      (best?.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY)
        ? chat
        : best,
    undefined,
  );
  const messages = useChatStore((state) => state.messages(newest?.id ?? ''));
  const currentUserId = useChatStore((state) => state.currentUserId);
  const { api: contactsApi } = useContactsApi();
  const blockedJids = useBlockedJids(contactsApi);
  if (row === undefined) {
    return null;
  }
  const previewed =
    newest === undefined ? undefined : previewMessage(newest, messages, blockedJids, currentUserId);
  const preview = previewParts(previewed?.deleted === true ? undefined : previewed, {
    isGroup: true,
    currentUserId,
  });
  const body =
    previewed === undefined
      ? ''
      : plainPreviewBody(newest!, previewed, preview.body, currentUserId);
  const subtitle =
    row.chatKind === 'channel'
      ? channelSubscriberLabel(row.subscriberCount ?? row.memberCount ?? 0)
      : topicCountLabel(row.topicCount);
  const anyPinned = row.topics.some((topic) => topic.pinnedAt !== undefined);
  const generalTopic = topics.find((topic) => topic.topic?.isGeneral === true) ?? topics[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${subtitle}`}
      onPress={onPress}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      className="h-[76px] flex-row items-center bg-background pl-4 active:bg-surface-raised"
    >
      <EntityAvatar
        chat={{
          id: generalTopic?.id ?? groupId,
          title: row.title,
          avatarUrl: generalTopic?.avatarUrl,
        }}
        size={52}
      />
      <View className="ml-3 h-full flex-1 flex-row items-center border-b border-[#1a1a1a] pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-baseline gap-1.5">
              <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
                {row.title}
              </Text>
              {row.chatKind === 'channel' ? (
                <View accessibilityRole="image" accessibilityLabel="Channel">
                  <Megaphone size={14} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
              {anyPinned ? (
                <View accessibilityRole="image" accessibilityLabel="Pinned chat">
                  <Pin size={14} color={MUTED_FOREGROUND} />
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
            <View className="mr-2 min-w-0 flex-1 flex-row items-center gap-1.5">
              <PreviewIcon kind={preview.kind} />
              <Text numberOfLines={1} className="flex-1 text-[14px] text-muted-foreground">
                {preview.prefix ? <Text color="#d4d4d4">{preview.prefix}</Text> : null}
                {body}
              </Text>
            </View>
            {row.unread > 0 ? <UnreadBadge count={row.unread} muted={row.muted} /> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
