import { topicActivityView, typingLabel } from '@zilar/chat-core';
import { palette } from '@zilar/ui-tokens';
import { useRouter } from 'expo-router';
import { ChevronLeft, Images, Lock, Megaphone, MoreVertical, Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AiActivityMarks } from '@/components/chat/ai-activity-marks';
import { AiBadge } from '@/components/chat/ai-badge';
import { AisHereSheet } from '@/components/chat/ais-here-sheet';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import {
  TopicPeopleLine,
  memberPerson,
  type TopicLinePerson,
} from '@/components/chat/topic-people-line';
import { TypingDots } from '@/components/chat/typing-dots';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/chat-api';
import { chatSubtitle } from '@zilar/chat-core';
import { cn } from '@/lib/utils';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { connectionLabel } from '@/lib/connection';
import type { ChatSummary } from '@/lib/types';
import { useDelayed } from '@zilar/client-core';
import { useChatStore } from '@/store/chat-store-provider';

type TypingStatus = { status?: string };

export function dmHandleFor(chat: ChatSummary, contacts: Contact[]): string | undefined {
  if (chat.kind !== 'dm' || chat.isAI) {
    return undefined;
  }
  const local = chat.id.split('@')[0]?.toLowerCase();
  const contact = contacts.find(
    (entry) => entry.jid === chat.id || entry.userId.toLowerCase() === local,
  );
  const handle = contact?.handle;
  return handle === undefined || handle === null || handle === '' ? undefined : handle;
}

type ChatHeaderProps = {
  chat: ChatSummary;
  onBack: () => void;
  onSearchInChat?: () => void;
  onOpenMedia?: () => void;
  topicGroupName?: string;
  onOpenInfo?: () => void;
  onOpenGroup?: (groupId: string) => void;
};

export function ChatHeader({
  chat,
  onBack,
  onSearchInChat,
  onOpenMedia,
  topicGroupName,
  onOpenInfo,
  onOpenGroup,
}: ChatHeaderProps) {
  const router = useRouter();
  const iconColor = ICON;
  const status = useChatStore((state) => state.status);
  const contacts = useChatStore((state) => state.contacts);
  const dmHandle = dmHandleFor(chat, contacts);
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const topic = chat.topic;
  const isTopic = topic !== undefined;
  const groupIdForChat = useChatStore((state) => state.groupIdForChat);
  const topicGroupId = isTopic ? (chat.groupId ?? groupIdForChat(chat.id)) : undefined;
  const groupDetail = useChatStore((state) =>
    topicGroupId === undefined ? undefined : state.groupDetail(topicGroupId),
  );
  const aiStatusText = useChatStore(
    (state) => (state.typing[chat.id] as TypingStatus | undefined)?.status,
  );
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  const typing = typingLabel(chat, names ?? []);
  const writing = chat.isAI && (typing !== undefined || hasDraft);
  const connection = useDelayed(connectionLabel(status), 1500);
  const aiLine = aiStatusText === undefined ? undefined : `${aiStatusText}…`;
  const subtitle =
    connection ?? aiLine ?? (writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date())));
  const working = chat.isAI && chat.aiStatus === 'working';
  const [aisHereOpen, setAisHereOpen] = useState(false);
  const topicActivity =
    topic === undefined
      ? undefined
      : topicActivityView(topic.activity, topic.doneAt, topic.isGeneral);
  const groupTarget = onOpenGroup !== undefined ? (chat.groupId ?? undefined) : undefined;
  const topicPeople = (topic?.memberIds ?? [])
    .map((memberId) => memberPerson(memberId, groupDetail))
    .filter((person): person is TopicLinePerson => person !== undefined);
  const topicAis: TopicLinePerson[] = (topic?.ais ?? []).map((ai) => ({
    id: ai.id,
    name: ai.name,
    ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
  }));
  const topicCount =
    topic === undefined
      ? 0
      : topic.memberIds === undefined && topic.ais === undefined
        ? (chat.memberCount ?? 0)
        : (topic.memberIds?.length ?? 0) + (topic.ais?.length ?? 0);
  const showPeopleLine = isTopic && connection === undefined && aiLine === undefined;
  const title = (
    // `justify-center` keeps the two text lines on the avatar's centre line: the
    // wrapper stretches, so without it the content reads about 11 dp too high.
    <View className={cn('ml-2.5 min-w-0 flex-1 justify-center', isTopic && 'gap-[3px]')}>
      <View className="flex-row items-center gap-1.5">
        <Text
          numberOfLines={1}
          className={cn(
            'shrink font-semibold text-foreground',
            isTopic ? 'text-[17px] leading-[22px]' : 'text-[15px] leading-5',
          )}
        >
          {chat.title}
        </Text>
        {chat.chatKind === 'channel' ? (
          <View accessibilityRole="image" accessibilityLabel="Channel">
            <Megaphone size={14} color={MUTED_FOREGROUND} />
          </View>
        ) : null}
        {isTopic && chat.topic?.visibility === 'private' ? (
          <View
            accessibilityRole="image"
            accessibilityLabel="Private topic"
            className="shrink-0 flex-row items-center gap-1 rounded-full border border-divider px-1.5 py-0.5"
          >
            <Lock size={10} color={MUTED_FOREGROUND} />
            <Text className="text-[10px] font-medium text-muted-foreground">Private</Text>
          </View>
        ) : null}
        {chat.isAI ? <AiBadge /> : null}
      </View>
      {showPeopleLine ? (
        <TopicPeopleLine
          people={topicPeople}
          ais={topicAis}
          count={topicCount}
          writers={names ?? []}
          {...(topicGroupName === undefined ? {} : { groupName: topicGroupName })}
          {...(groupTarget === undefined ? {} : { onOpenGroup: () => onOpenGroup?.(groupTarget) })}
        />
      ) : (
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink text-[12px] leading-4 text-muted-foreground">
            {subtitle}
          </Text>
          {working || writing || aiLine !== undefined ? (
            <TypingDots color={MUTED_FOREGROUND} />
          ) : null}
        </View>
      )}
    </View>
  );
  return (
    <>
      <View className="min-h-16 flex-row items-center gap-1 border-b border-divider bg-surface px-1">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={24} color={iconColor} />
        </IconButton>
        <EntityAvatar chat={chat} size={36} online={chat.online} ai={chat.isAI} />
        {isTopic && onOpenInfo !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Topic info for ${chat.title}`}
            onPress={onOpenInfo}
            className="min-w-0 flex-1 justify-center"
          >
            {title}
          </Pressable>
        ) : groupTarget !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open group ${chat.title}`}
            onPress={() => onOpenGroup?.(groupTarget)}
            className="min-w-0 flex-1 justify-center"
          >
            {title}
          </Pressable>
        ) : dmHandle !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${chat.title}'s profile`}
            onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: dmHandle } })}
            className="min-w-0 flex-1 justify-center"
          >
            {title}
          </Pressable>
        ) : (
          title
        )}
        {topic !== undefined && topicActivity !== undefined && topicActivity.active.length > 0 ? (
          <IconButton
            label={`AIs here: ${topicActivity.label}`}
            onPress={() => setAisHereOpen(true)}
          >
            <AiActivityMarks
              activity={topic.activity}
              doneAt={topic.doneAt}
              isGeneral={topic.isGeneral}
              ringColor={palette.surface}
            />
          </IconButton>
        ) : null}
        {onOpenMedia !== undefined ? (
          <IconButton label="Media, files and links" onPress={onOpenMedia}>
            <Images size={20} color={iconColor} />
          </IconButton>
        ) : null}
        {onSearchInChat !== undefined ? (
          <IconButton label="Search in chat" onPress={onSearchInChat}>
            <Search size={20} color={iconColor} />
          </IconButton>
        ) : null}
        {isTopic && onOpenInfo !== undefined ? (
          <IconButton label="More options" onPress={onOpenInfo}>
            <MoreVertical size={20} color={iconColor} />
          </IconButton>
        ) : null}
      </View>
      {topic !== undefined ? (
        <AisHereSheet visible={aisHereOpen} onClose={() => setAisHereOpen(false)} chat={chat} />
      ) : null}
    </>
  );
}
