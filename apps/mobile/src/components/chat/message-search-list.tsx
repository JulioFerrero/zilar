import { formatListTime } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { LoadError } from '@/components/chat/load-error';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import type { SearchApi, SearchItem } from '@/lib/search-api';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';
import { groupSearchByChat, nearEnd, searchResultTitle } from './message-search';
import { openSearchHitEffect } from './search-jump';
import { SearchHitLine } from './search-snippet';
import { useMessageSearch, type MessageSearchView } from './use-message-search';

/**
 * One message hit: avatar, chat/topic breadcrumb, sender, time and snippet.
 * Tapping opens that chat or topic and jumps to the message once it loads
 * (see `openAtMessage` in the store).
 */
const MessageSearchHit = memo(function MessageSearchHit({
  item,
  heading,
  onOpen,
}: {
  item: SearchItem;
  heading: string;
  onOpen: (item: SearchItem) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open message from ${item.senderName} in ${heading}`}
      onPress={() => onOpen(item)}
      className="w-full flex-row items-center gap-3 rounded-[12px] p-[10px] active:bg-surface-raised"
    >
      <Avatar id={item.chatJid} name={heading} size={36} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline gap-1.5">
          <Text
            numberOfLines={1}
            className="flex-1 text-[13px] font-semibold leading-5 text-foreground"
          >
            {heading}
          </Text>
          <Text className="shrink-0 pl-1.5 font-mono text-[11px] text-subtle-foreground">
            {formatListTime(new Date(item.at), new Date())}
          </Text>
        </View>
        <SearchHitLine item={item} />
      </View>
    </Pressable>
  );
});

interface MessageSearchListProps {
  searchApi: SearchApi;
  query: string;
  /** Narrow to one chat ("Search in this chat" from a chat header). */
  chatFilter?: string;
  /** Called when the jump lands nowhere, so the screen can say so. */
  onNotFound: (chatJid: string) => void;
}

/**
 * The Messages section of the chat list (T-0138): hits grouped by chat,
 * newest group first, paging forward on scroll. Empty, loading, error and
 * rate-limited states, mirroring web's `MessageSearchResults`. The search
 * field itself lives in the chat list header (`src/app/index.tsx`); a tap on
 * a hit opens that chat at the message.
 */
export function MessageSearchList({
  searchApi,
  query,
  chatFilter,
  onNotFound,
}: MessageSearchListProps) {
  const router = useRouter();
  const search = useMessageSearch(searchApi, query, chatFilter);
  const chats = useChatStore((state) => state.chats);
  const openAtMessage = useChatStore((state) => state.openAtMessage);
  // Mirrored from an effect, read only in the jump callback: assigning a ref
  // during render would not update as expected (web does the same dance with
  // its top-hit ref).
  const notFoundRef = useRef(onNotFound);
  useEffect(() => {
    notFoundRef.current = onNotFound;
  }, [onNotFound]);

  const openHit = useCallback(
    (item: SearchItem): void => {
      // One attempt: the store's `openAtMessage` pages backwards at most
      // `MESSAGE_JUMP_MAX_PAGES` history pages, then gives up with
      // "Message not found" — the chat opens at its bottom with the notice,
      // never a retry loop (T-0157).
      // An unexpected failure (history or router) must not vanish: show the
      // same miss notice instead of leaving the user on a spinner. Interruption
      // is neither caught nor reported.
      const miss = Effect.sync(() => {
        notFoundRef.current(item.chatJid);
      });
      Effect.runFork(
        openSearchHitEffect(
          {
            openAtMessage,
            pushChat: (chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } }),
            pushChatNotFound: (chatId) =>
              router.push({ pathname: '/chat/[id]', params: { id: chatId, notFound: '1' } }),
            onNotFound: (chatId) => notFoundRef.current(chatId),
          },
          item.chatJid,
          item.messageId,
        ).pipe(
          Effect.catch(() => miss),
          Effect.catchDefect(() => miss),
        ),
      );
    },
    [openAtMessage, router],
  );

  if (search.status === 'idle' || search.status === 'unavailable') {
    return null;
  }
  if (search.status === 'loading') {
    return (
      <View accessibilityLabel="Searching messages" className="flex-col gap-0.5 px-2">
        <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
          Messages
        </Text>
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">Searching…</Text>
      </View>
    );
  }
  if (search.status === 'error') {
    return (
      <View className="flex-col gap-0.5 px-2">
        <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
          Messages
        </Text>
        <LoadError message={search.message} onRetry={search.retry} />
      </View>
    );
  }
  if (search.items.length === 0) {
    return (
      <View className="flex-col gap-0.5 px-2">
        <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
          Messages
        </Text>
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">No messages found</Text>
      </View>
    );
  }
  return <MessageSearchGroups search={search} chats={chats} openHit={openHit} />;
}

function MessageSearchGroups({
  search,
  chats,
  openHit,
}: {
  search: Extract<MessageSearchView, { status: 'ready' }>;
  chats: ChatSummary[];
  openHit: (item: SearchItem) => void;
}) {
  const byId = new Map(chats.map((chat) => [chat.id, chat] as const));
  const titles = new Map(chats.map((chat) => [chat.id, chat.title] as const));
  const groups = groupSearchByChat(search.items, titles);

  return (
    <ScrollView
      className="flex-1 px-2"
      keyboardShouldPersistTaps="handled"
      onScroll={
        search.nextBefore !== undefined && search.loadMore !== undefined
          ? (event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              if (nearEnd(contentOffset.y, contentSize.height, layoutMeasurement.height)) {
                search.loadMore?.();
              }
            }
          : undefined
      }
      scrollEventThrottle={16}
    >
      <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
        Messages
      </Text>
      {groups.map((group) => (
        <View key={`group:${group.chatJid}`}>
          <View className="flex-row items-center gap-2 px-[10px] pb-0.5 pt-1.5">
            <Avatar id={group.chatJid} name={group.title} size={20} />
            <Text numberOfLines={1} className="text-[12px] font-medium text-muted-foreground">
              {group.title}
            </Text>
          </View>
          {group.items.map((item) => {
            const chat = byId.get(item.chatJid);
            // A topic hit shows `Group › Topic` (web does the same); the
            // title is the topic name, `groupTitle` the group.
            const heading =
              chat?.topic !== undefined && chat.groupTitle !== undefined
                ? searchResultTitle(chat.groupTitle, chat.title)
                : group.title;
            return (
              <MessageSearchHit
                key={`${item.chatJid}:${item.messageId}`}
                item={item}
                heading={heading}
                onOpen={openHit}
              />
            );
          })}
        </View>
      ))}
      {search.nextBefore === undefined ? null : search.pageError !== undefined ? (
        <View className="flex-row items-center justify-between gap-3 px-[10px] py-3">
          <Text className="flex-1 text-[13px] text-muted-foreground">
            {search.pageError.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading more messages"
            onPress={search.pageError.retry}
            className="rounded px-2 py-1 active:bg-surface-raised"
          >
            <Text className="text-[13px] font-semibold text-foreground">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View className="items-center py-3">
          <ActivityIndicator color={ACCENT} />
        </View>
      )}
    </ScrollView>
  );
}
