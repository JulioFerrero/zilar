import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, Bot, Search, Settings, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatActionsSheet } from '@/components/chat/chat-actions-sheet';
import { ChatListItem } from '@/components/chat/chat-list-item';
import { GroupListItem } from '@/components/chat/group-list-item';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { LoadError, LoadErrorBanner } from '@/components/chat/load-error';
import { MessageSearchList } from '@/components/chat/message-search-list';
import { NewChatButton } from '@/components/chat/new-chat-button';
import { ChatListSkeleton } from '@/components/chat/skeleton';
import { PeopleSearchResult } from '@/components/contacts/people-search-result';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { connectionLabel } from '@/lib/connection';
import { well } from '@/lib/depth';
import { chatListModel } from '@/lib/chat-list';
import { unreadCount } from '@/lib/filter';
import { createSearchApi } from '@/lib/search-api';
import { getSessionToken } from '@/lib/session-token';
import { topicsOfGroup } from '@/lib/topics';
import type { ChatFolder } from '@/lib/types';
import { createMockSearchApi } from '@/mock/search';
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
  const params = useLocalSearchParams<{ searchChat?: string }>();
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
  const me = useChatStore((state) => state.me);
  const [searchOpen, setSearchOpen] = useState(false);
  // Typing `@handle` looks the person up above the other results (T-0193):
  // the search field's Enter key bumps `submitRequest` so the lookup fires
  // at once instead of waiting out the debounce.
  const [submitRequest, setSubmitRequest] = useState(0);
  // "Search in this chat" from a chat header arrives as `?searchChat=<id>`:
  // the search opens at once, scoped to that chat until the chip clears.
  const searchChatParam = typeof params.searchChat === 'string' ? params.searchChat : undefined;
  const [searchChat, setSearchChat] = useState<string | undefined>(undefined);
  // Adjusted during render (as the pull-to-refresh spinner above), not in an
  // effect: a `?searchChat=` navigation opens the scoped search at once.
  const [lastSearchChatParam, setLastSearchChatParam] = useState(searchChatParam);
  if (searchChatParam !== lastSearchChatParam) {
    setLastSearchChatParam(searchChatParam);
    if (searchChatParam !== undefined && searchChatParam !== '') {
      setSearchChat(searchChatParam);
      setSearchOpen(true);
    }
  }
  const searchChatTitle =
    searchChat === undefined ? undefined : chats.find((chat) => chat.id === searchChat)?.title;
  // The message-search API, real or mock like the store itself: tests run on
  // the mock store (`NODE_ENV=test`), UI work on `EXPO_PUBLIC_ZILAR_MOCK`.
  const searchApi = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? createMockSearchApi()
        : createSearchApi(getSessionToken),
    [],
  );
  const [refreshing, setRefreshing] = useState(false);
  // A search hit that lands nowhere ("Message not found"): the chat still
  // opens at its bottom; the inline notice says the message is not there.
  const [searchMiss, setSearchMiss] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  // The chat id (or `group:<groupId>`) whose action sheet is open; the
  // sheet resolves it to the underlying rows below.
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [actionMuteOpen, setActionMuteOpen] = useState(false);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
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
  // Pinned chats/topics float first and archived chats leave the main list
  // for the Archived entry at the bottom (T-0135, `lib/chat-list`).
  const { rows: visibleRows, archived } = useMemo(
    () => chatListModel(chats, { folder: activeFolder, search }),
    [chats, activeFolder, search],
  );
  const listView = chatsListView(chatsLoad, chats.length);
  const counts = useMemo(
    () =>
      Object.fromEntries(FOLDER_KEYS.map((key) => [key, unreadCount(chats, key)])) as Record<
        ChatFolder,
        number
      >,
    [chats],
  );

  const openActions = (id: string) => {
    setActionMuteOpen(false);
    setActionError('');
    setActionFor(id);
  };

  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
    setSearchMiss(null);
    setSearchChat(undefined);
    setSubmitRequest(0);
  };

  // The rows behind the open action sheet: a group resolves to its General
  // topic row (the pref row a group mute/pin sits on). T-0139: only a
  // General row enables the pref rows — when General is absent (older
  // servers send no `topics`, or it is archived/filtered out) the sheet
  // still opens the group screen, but pin/mute/archive stay disabled, since
  // a group pref on a non-General JID would mute one topic, not the group.
  const actionContext = useMemo(() => {
    if (actionFor === null) {
      return undefined;
    }
    if (actionFor.startsWith('group:')) {
      const groupId = actionFor.slice('group:'.length);
      const topics = topicsOfGroup(chats, groupId);
      const general = topics.find((topic) => topic.topic?.isGeneral === true);
      const fallback = general ?? topics[0];
      const groupTitle = general?.groupTitle ?? fallback?.groupTitle ?? fallback?.title ?? 'Group';
      return { chat: general, groupId, groupTitle };
    }
    const chat = chats.find((entry) => entry.id === actionFor);
    return chat === undefined ? undefined : { chat, groupId: undefined, groupTitle: undefined };
  }, [actionFor, chats]);

  const runChatPref = (chatId: string, input: Parameters<typeof setChatPref>[1]) => {
    setActionBusy(true);
    setActionError('');
    void setChatPref(chatId, input)
      .then(() => {
        setActionFor(null);
        setActionMuteOpen(false);
      })
      .catch(() => setActionError('Could not save. Try again.'))
      .finally(() => setActionBusy(false));
  };

  const closeActions = () => {
    if (!actionBusy) {
      setActionFor(null);
      setActionMuteOpen(false);
      setActionError('');
    }
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (searchMiss !== null) {
      setSearchMiss(null);
    }
  };

  // A full-screen search (T-0138): typing 2+ characters searches message
  // text across every visible chat below the name matches; a shorter query
  // keeps filtering chat names, like before. Typing `@handle` also shows the
  // People section above (T-0193), even under 2 characters — the section
  // itself decides whether the handle is worth looking up.
  const messageQuery = search.trim().length >= 2 ? search : null;
  const peopleSearch = search.trim().startsWith('@');
  const { api: contactsApi } = useContactsApi();

  const searchHeader = searchOpen ? (
    <View className="flex-row items-center gap-3 px-4 py-2">
      <View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}>
        <Search size={16} color="#8a8a8a" />
        <TextInput
          autoFocus
          value={search}
          onChangeText={onSearchChange}
          onSubmitEditing={() => setSubmitRequest((count) => count + 1)}
          placeholder="Search, or type @username"
          placeholderTextColor={MUTED_FOREGROUND[scheme]}
          accessibilityLabel="Search chats, messages and people"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 text-[15px] text-foreground"
        />
        {search.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => onSearchChange('')}
          >
            <X size={16} color={MUTED_FOREGROUND[scheme]} />
          </Pressable>
        ) : null}
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
        <IconButton label="Settings" onPress={() => router.push('/settings')}>
          <Settings size={20} color={ICON[scheme]} />
        </IconButton>
      </View>
    </View>
  );

  if (searchOpen && messageQuery !== null) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        {searchHeader}
        {searchChat !== undefined ? (
          <View className="flex-row items-center px-4 pb-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Clear chat filter${searchChatTitle === undefined ? '' : `: ${searchChatTitle}`}`}
              onPress={() => setSearchChat(undefined)}
              className="flex-row items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1.5"
            >
              <Text numberOfLines={1} className="max-w-[240px] text-[12px] text-foreground">
                {searchChatTitle === undefined ? 'This chat only' : `In ${searchChatTitle} only`}
              </Text>
              <X size={12} color={MUTED_FOREGROUND[scheme]} />
            </Pressable>
          </View>
        ) : null}
        {peopleSearch ? (
          <PeopleSearchResult
            api={contactsApi}
            text={search}
            chats={chats}
            myJid={me?.jid ?? undefined}
            onMessage={(chatId) => {
              closeSearch();
              router.push({ pathname: '/chat/[id]', params: { id: chatId } });
            }}
            onOpenRequests={() => {
              closeSearch();
              router.push('/settings/requests');
            }}
            submitRequest={submitRequest}
          />
        ) : null}
        <MessageSearchList
          searchApi={searchApi}
          query={messageQuery}
          {...(searchChat === undefined ? {} : { chatFilter: searchChat })}
          onNotFound={() => setSearchMiss(messageQuery)}
        />
        {searchMiss !== null ? (
          <View className="px-4 pb-2">
            <Text role="alert" className="text-[13px] text-muted-foreground">
              Message not found
            </Text>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // A short `@handle` (under 2 characters, e.g. '@j') shows only the People
  // section: today only chat names filter here, and chat names keep working
  // below in the normal list.
  if (searchOpen && peopleSearch) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        {searchHeader}
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          <PeopleSearchResult
            api={contactsApi}
            text={search}
            chats={chats}
            myJid={me?.jid ?? undefined}
            onMessage={(chatId) => {
              closeSearch();
              router.push({ pathname: '/chat/[id]', params: { id: chatId } });
            }}
            onOpenRequests={() => {
              closeSearch();
              router.push('/settings/requests');
            }}
            submitRequest={submitRequest}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {searchHeader}
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
              onLongPress={() => openActions(item.chat.id)}
            />
          ) : (
            <GroupListItem
              groupId={item.groupId}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.groupId } })}
              onLongPress={() => openActions(`group:${item.groupId}`)}
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
      {archived.length > 0 ? (
        <View className="border-t border-divider">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              archivedOpen ? 'Hide archived chats' : `Show archived chats, ${archived.length}`
            }
            onPress={() => setArchivedOpen((value) => !value)}
            className="flex-row items-center justify-center gap-1.5 px-4 py-3 active:bg-surface-raised"
          >
            <Archive size={16} color={ICON[scheme]} />
            <Text className="text-[14px] font-medium text-muted-foreground">
              Archived ({archived.length})
            </Text>
          </Pressable>
          {archivedOpen
            ? archived.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
                  onLongPress={() => openActions(chat.id)}
                />
              ))
            : null}
        </View>
      ) : null}
      <ChatActionsSheet
        chat={actionContext?.chat ?? null}
        groupTitle={actionContext?.groupTitle}
        groupId={actionContext?.groupId}
        busy={actionBusy}
        error={actionError}
        muteOpen={actionMuteOpen}
        onOpenMute={() => setActionMuteOpen(true)}
        onMute={(duration) =>
          actionContext?.chat === undefined
            ? undefined
            : runChatPref(actionContext.chat.id, {
                mutedUntil: mutedUntilFor(duration, new Date()),
              })
        }
        onUnmute={() =>
          actionContext?.chat === undefined
            ? undefined
            : runChatPref(actionContext.chat.id, { mutedUntil: null })
        }
        onTogglePin={() =>
          actionContext?.chat === undefined
            ? undefined
            : runChatPref(actionContext.chat.id, {
                pinned: actionContext.chat.pinnedAt === undefined,
              })
        }
        onToggleArchive={() =>
          actionContext?.chat === undefined
            ? undefined
            : runChatPref(actionContext.chat.id, {
                archived: actionContext.chat.archived !== true,
              })
        }
        onOpenGroup={(groupId) => {
          closeActions();
          router.push({ pathname: '/group/[id]', params: { id: groupId } });
        }}
        onClose={closeActions}
      />
      <NewChatButton />
    </SafeAreaView>
  );
}
