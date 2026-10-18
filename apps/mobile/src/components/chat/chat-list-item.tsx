import { formatListTime, previewMessage, previewParts, typingLabel } from '@zilar/chat-core';
import { Megaphone, Pin, VolumeX } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { tap } from '@/components/chat/haptics';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { PreviewIcon } from '@/components/chat/preview-icon';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { Text } from '@/components/ui/text';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { useComposerDraft } from '@/lib/composer-drafts';
import { primaryKey, raisedPill } from '@/lib/depth';
import { useBlockedJids } from '@/lib/blocked-users';
import { channelSubscriberCount, channelSubscriberLabel } from '@/lib/channels';
import { type ChatSummary, type MessageStatus } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

type ChatListItemProps = {
  chat: ChatSummary;
  onPress: () => void;
  onLongPress?: () => void;
};

/** The chat row, 76 px tall at the default font size (D24, ui-style.md §5). */
export function ChatListItem({ chat, onPress, onLongPress }: ChatListItemProps) {
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  // T-1181 (MUX-4): a chat the user typed in but did not send shows its
  // composer draft instead of the last message, as Telegram does. `hasDraft`
  // above is the AI reply draft, a different thing.
  const composerDraft = useComposerDraft(chat.id);
  const draftLine = composerDraft.trimStart().split('\n')[0] ?? '';
  const showDraft = composerDraft.trim().length > 0;
  const last = chat.lastMessage;
  const messages = useChatStore((state) => state.messages(chat.id));
  const currentUserId = useChatStore((state) => state.currentUserId);
  const { api: contactsApi } = useContactsApi();
  const blockedJids = useBlockedJids(contactsApi);
  const previewed = previewMessage(chat, messages, blockedJids, currentUserId);
  const typing = typingLabel(chat, names ?? []);
  const label = chat.isAI && (typing !== undefined || hasDraft) ? 'writing…' : typing;
  const preview = previewParts(previewed?.deleted === true ? undefined : previewed, {
    isGroup: chat.kind === 'group',
    currentUserId,
  });
  const deletedPreview = previewed?.deleted === true ? 'Message deleted' : undefined;
  // An incoming AI reply (a DM AI or a group AI reply) previews as plain text; a
  // human message or your own stays literal.
  const body = plainPreviewBody(chat, previewed, preview.body, currentUserId);
  const showTicks = chat.unread === 0 && last?.senderId === currentUserId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      onPress={onPress}
      onLongPress={
        onLongPress === undefined
          ? undefined
          : () => {
              tap();
              onLongPress();
            }
      }
      className="min-h-[76px] flex-row items-center bg-background pl-4 active:bg-surface-raised"
    >
      <EntityAvatar chat={chat} size={52} online={chat.online} ai={chat.isAI} />
      <View className="ml-3 flex-1 self-stretch flex-row items-center border-b border-[#1a1a1a] py-3 pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center">
              <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
                {chat.title}
              </Text>
              {chat.isAI ? <AiBadge className="ml-1.5" /> : null}
              {chat.chatKind === 'channel' ? (
                // T-1355: a channel is one row (its General feed), so the row
                // paints the megaphone marker and "N subscribers" like the
                // group row's channel look and the header.
                <View className="ml-1.5 shrink-0 flex-row items-center gap-1">
                  <View accessibilityRole="image" accessibilityLabel="Channel">
                    <Megaphone size={14} color={MUTED_FOREGROUND} />
                  </View>
                  <Text numberOfLines={1} className="text-[12px] text-subtle-foreground">
                    {channelSubscriberLabel(channelSubscriberCount(chat, undefined))}
                  </Text>
                </View>
              ) : null}
              {chat.pinnedAt !== undefined ? (
                <View className="ml-2" accessibilityRole="image" accessibilityLabel="Pinned chat">
                  <Pin size={14} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
              {chat.muted ? (
                <View className="ml-2">
                  <VolumeX size={16} color={MUTED_FOREGROUND} />
                </View>
              ) : null}
            </View>
            {last ? (
              <Text className="ml-2 shrink-0 font-mono text-[12px] text-subtle-foreground">
                {formatListTime(last.createdAt, new Date())}
              </Text>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center justify-between">
            {label !== undefined ? (
              <View className="mr-2 flex-1 flex-row items-center gap-1.5">
                <PulseDot color={MUTED_FOREGROUND} />
                <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
                  {label}
                </Text>
              </View>
            ) : showDraft ? (
              <Text numberOfLines={1} className="mr-2 flex-1 text-[14px] text-muted-foreground">
                <Text className="text-danger">Draft:</Text> {draftLine}
              </Text>
            ) : deletedPreview !== undefined ? (
              <Text
                numberOfLines={1}
                className="mr-2 flex-1 text-[14px] italic text-muted-foreground"
              >
                {deletedPreview}
              </Text>
            ) : (
              <View className="mr-2 flex-1 flex-row items-center gap-1.5">
                <PreviewIcon kind={preview.kind} />
                <Text numberOfLines={1} className="flex-1 text-[14px] text-muted-foreground">
                  {preview.prefix ? <Text color="#d4d4d4">{preview.prefix}</Text> : null}
                  {body}
                </Text>
              </View>
            )}
            {chat.unread > 0 ? (
              <UnreadBadge count={chat.unread} muted={chat.muted} />
            ) : chat.unreadMark === true ? (
              // T-1248: a hand-set unread mark shows a plain dot (no count), in
              // the unread badge's spot and colours. A fresh view per look, like
              // the badge, so a live view never swaps gradients (see above).
              <View
                key={chat.muted ? 'muted' : 'live'}
                accessibilityRole="image"
                accessibilityLabel="Marked unread"
                style={chat.muted ? raisedPill : primaryKey}
                className="h-2.5 w-2.5 shrink-0 rounded-full"
              />
            ) : showTicks && last ? (
              <Ticks
                status={last.status as MessageStatus}
                color={last.status === 'read' ? SEEN : MUTED_FOREGROUND}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
