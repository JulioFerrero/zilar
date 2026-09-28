import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatListItem } from '@/components/chat/chat-list-item';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { NewChatButton } from '@/components/chat/new-chat-button';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { connectionLabel } from '@/lib/connection';
import { filterChats, unreadCount } from '@/lib/filter';
import type { ChatFolder } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

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
  const search = useChatStore((state) => state.search);
  const setSearch = useChatStore((state) => state.setSearch);
  const activeFolder = useChatStore((state) => state.activeFolder);
  const setActiveFolder = useChatStore((state) => state.setActiveFolder);
  const status = useChatStore((state) => state.status);
  const connection = connectionLabel(status);
  const [searchOpen, setSearchOpen] = useState(false);

  const visibleChats = useMemo(
    () => filterChats(chats, { folder: activeFolder, search }),
    [chats, activeFolder, search],
  );
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
        <View className="flex-row items-center gap-3 px-4 pt-1">
          <View className="h-9 flex-1 flex-row items-center gap-2 rounded-full bg-muted px-3">
            <Search size={16} color={MUTED_FOREGROUND[scheme]} />
            <TextInput
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder="Search"
              placeholderTextColor={MUTED_FOREGROUND[scheme]}
              accessibilityLabel="Search chats"
              className="flex-1 text-[16px] text-foreground"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            onPress={closeSearch}
          >
            <Text className="text-[16px] text-accent">Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row items-center justify-between px-4 pt-1">
          <Text className="text-[34px] font-bold leading-10 text-foreground">Chats</Text>
          <IconButton label="Search" onPress={() => setSearchOpen(true)}>
            <Search size={24} color={FOREGROUND[scheme]} />
          </IconButton>
        </View>
      )}
      <FolderTabs activeFolder={activeFolder} counts={counts} onSelect={setActiveFolder} />
      {connection !== undefined ? (
        <View className="border-b border-divider px-3 py-1">
          <Text className="text-center text-[12px] text-muted-foreground">{connection}</Text>
        </View>
      ) : null}
      <FlatList
        className="flex-1"
        data={visibleChats}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <View className="items-center px-6 pt-16">
            <Text className="text-[15px] text-muted-foreground">No chats found</Text>
          </View>
        }
      />
      <NewChatButton />
    </SafeAreaView>
  );
}
