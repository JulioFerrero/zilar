import { useRouter } from 'expo-router';
import { Bot, Search } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatListItem } from '@/components/chat/chat-list-item';
import { GroupListItem } from '@/components/chat/group-list-item';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { LoadError, LoadErrorBanner } from '@/components/chat/load-error';
import { NewChatButton } from '@/components/chat/new-chat-button';
import { ChatListSkeleton } from '@/components/chat/skeleton';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { connectionLabel } from '@/lib/connection';
import { well } from '@/lib/depth';
import { filterChats, unreadCount } from '@/lib/filter';
import { groupRowFor, groupTopicChats } from '@/lib/topics';
import type { ChatFolder, ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';
import { chatsListView, emptyChatsText } from '@/store/types';

const FOLDER_KEYS: ChatFolder[] = ['all', 'personal', 'ai', 'work'];

export default function ChatsScreen() {
  return (
    <RequireAuth>
      <ChatsList />
    </RequireAuth>
  );
}

function ChatsList() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const chats = useChatStore((state) => state.chats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const search = useChatStore((state) => state.search);
  const setSearch = useChatStore((state) => state.setSearch);
  const activeFolder = useChatStore((state) => state.activeFolder);
  const setActiveFolder = useChatStore((state) => state.setActiveFolder);
  const status = useChatStore((state) => state.status);
  const connection = connectionLabel(status);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Clear the pull-to-refresh spinner as soon as the reload settles, however it
  // ends. Adjusted during render (as ChatList does on web), not in an effect.
  const [lastChatsLoad, setLastChatsLoad] = useState(chatsLoad);
  if (chatsLoad !== lastChatsLoad) {
    setLastChatsLoad(chatsLoad);
    if (refreshing && chatsLoad !== 'loading') {
      setRefreshing(false);
    }
  }

  // Groups with topics collapse to one row per group (title, "N topics",
  // aggregated unread, newest time, last-topic preview); a group without
  // topics from an older server keeps its chat row as today (T-0112).
  const visibleRows = useMemo(() => {
    const filtered = filterChats(chats, { folder: activeFolder, search });
    const byGroup = groupTopicChats(filtered);
    const topicIds = new Set([...byGroup.values()].flat().map((chat) => chat.id));
    const rows: ({ kind: 'chat'; chat: ChatSummary } | { kind: 'group'; groupId: string })[] =
      filtered.filter((chat) => !topicIds.has(chat.id)).map((chat) => ({ kind: 'chat', chat }));
    for (const [groupId, topics] of byGroup) {
      const row = groupRowFor(groupId, topics);
      if (row !== undefined) {
        rows.push({ kind: 'group', groupId });
      }
    }
    // Recency order: the newest message of the group (or chat) first.
    const timeOf = (row: (typeof rows)[number]): number => {
      if (row.kind === 'chat') {
        return row.chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
      }
      const topics = byGroup.get(row.groupId) ?? [];
      return Math.max(
        Number.NEGATIVE_INFINITY,
        ...topics.map((chat) => chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY),
      );
    };
    return rows.sort((left, right) => timeOf(right) - timeOf(left));
  }, [chats, activeFolder, search]);
  const listView = chatsListView(chatsLoad, chats.length);
  const counts = useMemo(
    () =>
      Object.fromEntries(FOLDER_KEYS.map((key) => [key, unreadCount(chats, key)])) as Record<
        ChatFolder,
        number
      >,
    [chats],
  );

  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {searchOpen ? (
        <View className="flex-row items-center gap-3 px-4 py-2">
          <View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}>
            <Search size={16} color="#8a8a8a" />
            <TextInput
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder="Search"
              placeholderTextColor={MUTED_FOREGROUND[scheme]}
              accessibilityLabel="Search chats"
              className="flex-1 text-[15px] text-foreground"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            onPress={closeSearch}
          >
            <Text className="text-[15px] text-foreground">Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row items-center justify-between px-4 py-2">
          <Text className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">
            Chats
          </Text>
          <View className="flex-row items-center gap-2">
            <IconButton label="My AIs" onPress={() => router.push('/ais')}>
              <Bot size={20} color={ICON[scheme]} />
            </IconButton>
            <IconButton label="Search" onPress={() => setSearchOpen(true)}>
              <Search size={20} color={ICON[scheme]} />
            </IconButton>
          </View>
        </View>
      )}
      <FolderTabs activeFolder={activeFolder} counts={counts} onSelect={setActiveFolder} />
      {connection !== undefined ? (
        <View className="border-b border-divider px-3 py-1">
          <Text className="text-center text-[12px] text-muted-foreground">{connection}</Text>
        </View>
      ) : null}
      {chatsLoad === 'error' && chats.length > 0 ? (
        <LoadErrorBanner message="Couldn't load chats" onRetry={reloadChats} />
      ) : null}
      <FlatList
        className="flex-1"
        data={visibleRows}
        keyExtractor={(row) => (row.kind === 'chat' ? row.chat.id : `group:${row.groupId}`)}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={MUTED_FOREGROUND[scheme]}
            onRefresh={() => {
              setRefreshing(true);
              reloadChats();
            }}
          />
        }
        renderItem={({ item }) =>
          item.kind === 'chat' ? (
            <ChatListItem
              chat={item.chat}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.chat.id } })}
            />
          ) : (
            <GroupListItem
              groupId={item.groupId}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.groupId } })}
            />
          )
        }
        ListEmptyComponent={
          listView === 'skeleton' ? (
            <ChatListSkeleton />
          ) : listView === 'error' ? (
            <LoadError message="Couldn't load chats" onRetry={reloadChats} />
          ) : (
            <View className="items-center px-6 pt-16">
              <Text className="text-[15px] text-muted-foreground">
                {emptyChatsText(chats.length)}
              </Text>
            </View>
          )
        }
      />
      <NewChatButton />
    </SafeAreaView>
  );
}
