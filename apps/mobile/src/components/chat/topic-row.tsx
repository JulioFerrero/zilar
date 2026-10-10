import { formatListTime, previewMessage } from '@zilar/chat-core';
import { Lock, Pin, VolumeX } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { Text } from '@/components/ui/text';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, raisedPill } from '@/lib/depth';
import { useBlockedJids } from '@/lib/blocked-users';
import { previewParts, typingLabel } from '@/lib/format';
import { topicStatusLabel } from '@/lib/topics';
import { type ChatSummary, type MessageStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

function TopicUnreadBadge({ count, muted }: { count: number; muted: boolean }) {
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

const STATUS_DOT: Record<string, string> = {
  open: 'bg-[#8a8a8a]',
  in_progress: 'bg-amber-400',
  in_review: 'bg-blue-400',
  blocked: 'bg-red-400',
  done: 'bg-green-400',
};

/**
 * One topic row on the topics screen (T-0112): the raised glyph tile, name
 * with a lock for private topics, pin/muted icons like the chat list rows
 * (T-0135), the status chip (dot + text, never color alone), a one-line
 * preview, the time and the unread badge (grey while muted). General renders
 * like every other topic; ordering lives in `lib/topics`.
 */
export function TopicRow({
  chat,
  onPress,
  onLongPress,
}: {
  chat: ChatSummary;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  const messages = useChatStore((state) => state.messages(chat.id));
  const currentUserId = useChatStore((state) => state.currentUserId);
  const { api: contactsApi } = useContactsApi();
  const blockedJids = useBlockedJids(contactsApi);
  const last = chat.lastMessage;
  const topic = chat.topic;
  const previewed = previewMessage(chat, messages, blockedJids, currentUserId);
  const typing = typingLabel(chat, names ?? []);
  const label = chat.isAI && (typing !== undefined || hasDraft) ? 'writing…' : typing;
  const preview = previewParts(previewed?.deleted === true ? undefined : previewed, {
    isGroup: true,
    currentUserId,
  });
  const deletedPreview = previewed?.deleted === true ? 'Message deleted' : undefined;
  const body = plainPreviewBody(chat, previewed, preview.body, currentUserId);
  const showTicks = chat.unread === 0 && last?.senderId === currentUserId;
  const status = topic?.status ?? 'open';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      onPress={onPress}
      onLongPress={onLongPress}
      className="h-[76px] flex-row items-center bg-background pl-4 active:bg-surface-raised"
    >
      <View className="h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-edge bg-surface-raised">
        <Text className="text-[20px] font-semibold text-foreground">{topic?.glyph ?? 'G'}</Text>
      </View>
      <View className="ml-3 h-full flex-1 flex-row items-center border-b border-[#1a1a1a] pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center">
              <Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">
                {chat.title}
              </Text>
              {topic?.visibility === 'private' ? (
                <View
                  accessibilityRole="image"
                  accessibilityLabel="Private topic"
                  className="ml-1.5 shrink-0"
                >
                  <Lock size={14} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
              {chat.isAI ? <AiBadge className="ml-1.5" /> : null}
              {chat.pinnedAt !== undefined ? (
                <View className="ml-2" accessibilityRole="image" accessibilityLabel="Pinned chat">
                  <Pin size={14} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
              {chat.muted ? (
                <View className="ml-2" accessibilityRole="image" accessibilityLabel="Muted chat">
                  <VolumeX size={14} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
            </View>
            {last ? (
              <Text className="ml-2 shrink-0 font-mono text-[12px] text-subtle-foreground">
                {formatListTime(last.createdAt, new Date())}
              </Text>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <View className="shrink-0 flex-row items-center gap-1 rounded-full border border-divider px-1.5 py-0.5">
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status] ?? STATUS_DOT['open'])}
              />
              <Text className="text-[11px] font-medium text-muted-foreground">
                {topicStatusLabel(status)}
              </Text>
            </View>
            {label !== undefined ? (
              <View className="mr-2 flex-1 flex-row items-center gap-1.5">
                <PulseDot color={MUTED_FOREGROUND} />
                <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
                  {label}
                </Text>
              </View>
            ) : deletedPreview !== undefined ? (
              <Text
                numberOfLines={1}
                className="mr-2 flex-1 text-[14px] italic text-muted-foreground"
              >
                {deletedPreview}
              </Text>
            ) : (
              <Text numberOfLines={1} className="mr-2 flex-1 text-[14px] text-muted-foreground">
                {preview.prefix ? <Text color="#d4d4d4">{preview.prefix}</Text> : null}
                {body}
              </Text>
            )}
            {chat.unread > 0 ? (
              <TopicUnreadBadge count={chat.unread} muted={chat.muted} />
            ) : showTicks && last ? (
              <Ticks
                status={last.status as MessageStatus}
                color={last.status === 'read' ? '#ededed' : MUTED_FOREGROUND}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
