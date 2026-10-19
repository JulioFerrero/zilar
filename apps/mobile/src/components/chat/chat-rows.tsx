import { useMemo, type RefObject, useRef, type ReactNode } from 'react';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { ChatListRow } from '@/lib/chat-list';
import type { PutChatPrefInput } from '@/lib/chat-prefs-api';
import { topicsOfGroup, groupRowFor, topicCountLabel } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';
import {
  Archive,
  Bell,
  BellOff,
  Pin,
  PinOff,
  type LucideIcon,
  Megaphone,
  VolumeX,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { MUTE_DURATIONS, mutedUntilFor } from '@/lib/chat-prefs';
import { MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import type { ChatSummary, MessageStatus } from '@/lib/types';
import { formatListTime, previewMessage, previewParts, typingLabel } from '@zilar/chat-core';
import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { tap } from '@/components/chat/haptics';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { PreviewIcon } from '@/components/chat/preview-icon';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { UnreadBadge } from '@/components/chat/unread-badge';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { channelSubscriberCount, channelSubscriberLabel } from '@/lib/channels';
import { useBlockedJids } from '@/lib/blocked-users';
import { useComposerDraft } from '@/lib/composer-drafts';
import { primaryKey, raisedPill } from '@/lib/depth';

function GroupListItem({
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

// The swipe's mute uses the longest offered duration; the sheet offers the full choice.
const SWIPE_MUTE_ID = MUTE_DURATIONS.find((entry) => entry.id === 'forever')?.id ?? 'week';

type SwipeActionProps = {
  label: string;
  accessibilityLabel: string;
  icon: LucideIcon;
  onPress: () => void;
};

function SwipeAction({ label, accessibilityLabel, icon: Icon, onPress }: SwipeActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="min-w-[64px] items-center justify-center gap-1 bg-surface-raised px-2 active:opacity-70"
    >
      <Icon size={20} color={MUTED_FOREGROUND} />
      <Text className="text-[11px] text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

type ChatRowSwipeProps = {
  chat: ChatSummary;
  onPref: (chatId: string, input: PutChatPrefInput) => void;
  openRef: RefObject<SwipeableMethods | null>;
  children: ReactNode;
};

function ChatRowSwipe({ chat, onPref, openRef, children }: ChatRowSwipeProps) {
  const ownRef = useRef<SwipeableMethods>(null);

  const act = (input: PutChatPrefInput) => {
    ownRef.current?.close();
    onPref(chat.id, input);
  };

  const pinned = chat.pinnedAt !== undefined;
  const muted = chat.muted === true;
  const archived = chat.archived === true;

  return (
    <Swipeable
      ref={ownRef}
      renderRightActions={() => (
        <View className="flex-row items-stretch">
          <SwipeAction
            label={pinned ? 'Unpin' : 'Pin'}
            accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
            icon={pinned ? PinOff : Pin}
            onPress={() => act({ pinned: chat.pinnedAt === undefined })}
          />
          <SwipeAction
            label={muted ? 'Unmute' : 'Mute'}
            accessibilityLabel={muted ? 'Unmute chat' : 'Mute chat'}
            icon={muted ? BellOff : Bell}
            onPress={() =>
              act(
                muted
                  ? { mutedUntil: null }
                  : { mutedUntil: mutedUntilFor(SWIPE_MUTE_ID, new Date()) },
              )
            }
          />
          <SwipeAction
            label={archived ? 'Unarchive' : 'Archive'}
            accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
            icon={Archive}
            onPress={() => act({ archived: chat.archived !== true })}
          />
        </View>
      )}
      onSwipeableWillOpen={() => {
        if (openRef.current !== null && openRef.current !== ownRef.current) {
          openRef.current.close();
        }
        openRef.current = ownRef.current;
      }}
    >
      {children}
    </Swipeable>
  );
}

export function chatRowKey(row: ChatListRow): string {
  return row.kind === 'chat' ? row.chat.id : `group:${row.groupId}`;
}

export function ChatRow({
  row,
  onPressChat,
  onPressGroup,
  onLongPress,
  onPref,
  openSwipeRef,
}: {
  row: ChatListRow;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  onPref?: ((chatId: string, input: PutChatPrefInput) => void) | undefined;
  openSwipeRef?: RefObject<SwipeableMethods | null> | undefined;
}) {
  if (row.kind === 'chat') {
    const item = (
      <ChatListItem
        chat={row.chat}
        onPress={() => onPressChat(row.chat.id)}
        onLongPress={() => onLongPress(row.chat.id)}
      />
    );
    if (onPref === undefined || openSwipeRef === undefined) {
      return item;
    }
    return (
      <ChatRowSwipe chat={row.chat} onPref={onPref} openRef={openSwipeRef}>
        {item}
      </ChatRowSwipe>
    );
  }
  return (
    <GroupRow
      groupId={row.groupId}
      onPressGroup={onPressGroup}
      onLongPress={onLongPress}
      onPref={onPref}
      openSwipeRef={openSwipeRef}
    />
  );
}

function GroupRow({
  groupId,
  onPressGroup,
  onLongPress,
  onPref,
  openSwipeRef,
}: {
  groupId: string;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  onPref: ((chatId: string, input: PutChatPrefInput) => void) | undefined;
  openSwipeRef: RefObject<SwipeableMethods | null> | undefined;
}) {
  const chats = useChatStore((state) => state.chats);
  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const row = (
    <GroupListItem
      groupId={groupId}
      onPress={() => onPressGroup(groupId)}
      onLongPress={() => onLongPress(`group:${groupId}`)}
    />
  );
  if (onPref === undefined || openSwipeRef === undefined) {
    return row;
  }
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  if (general === undefined) {
    return row;
  }
  return (
    <ChatRowSwipe chat={general} onPref={onPref} openRef={openSwipeRef}>
      {row}
    </ChatRowSwipe>
  );
}

/** The chat row, 76 px tall at the default font size (D24, ui-style.md §5). */
function ChatListItem({
  chat,
  onPress,
  onLongPress,
}: {
  chat: ChatSummary;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
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
