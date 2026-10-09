import { useLocalSearchParams, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { Archive, Search, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
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
import { peopleHandleFor } from '@/components/contacts/people-search';
import { PeopleSearchResult } from '@/components/contacts/people-search-result';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { Text } from '@/components/ui/text';
import { SearchField } from '@/components/ui/search-field';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { connectionLabel } from '@/lib/connection';
import { well } from '@/lib/depth';
import { chatListModel, chatSearchMatches } from '@/lib/chat-list';
import { unreadCount } from '@/lib/filter';
import { createSearchApi } from '@/lib/search-api';
import { getSessionToken } from '@/lib/session-token';
import { topicsOfGroup } from '@/lib/topics';
import { createMockSearchApi } from '@/mock/search';
import { useChatStore } from '@/store/chat-store-provider';
import { chatsListView, emptyChatsText } from '@/store/types';

export default function ChatsScreen() {
  return (
    <RequireAuth>
      <ChatsList />
    </RequireAuth>
  );
}

// Returns a copy of `keys` with `key` added (on) or removed (off).
function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
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
  const folders = useChatStore((state) => state.folders);
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
  const [actionError, setActionError] = useState('');
  // One change per chat at a time (one action per row): a second tap on the
  // same chat while its change saves is dropped; other chats are not blocked.
  // The ref is read only in handlers; the state drives the busy display.
  const prefInFlight = useRef(new Set<string>());
  const [prefBusy, setPrefBusy] = useState<ReadonlySet<string>>(() => new Set());
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
  const activeFolderDef = useMemo(
    () =>
      activeFolder === 'all' ? undefined : folders.find((folder) => folder.id === activeFolder),
    [activeFolder, folders],
  );
  const { rows: visibleRows, archived } = useMemo(
    () => chatListModel(chats, { folder: activeFolderDef, search }),
    [chats, activeFolderDef, search],
  );
  const listView = chatsListView(chatsLoad, chats.length);
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: unreadCount(chats, undefined) };
    for (const folder of folders) {
      next[folder.id] = unreadCount(chats, folder);
    }
    return next;
  }, [chats, folders]);

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

  const actionChatId = actionContext?.chat?.id;
  const actionBusy = actionChatId !== undefined && prefBusy.has(actionChatId);

  // A chat change that saves closes its sheet; a failure keeps it open with
  // the message.
  const saveChatPref = (chatId: string, input: Parameters<typeof setChatPref>[1]) => {
    if (prefInFlight.current.has(chatId)) {
      return;
    }
    prefInFlight.current.add(chatId);
    setPrefBusy((busy) => withKey(busy, chatId, true));
    setActionError('');
    Effect.runFork(
      Effect.tryPromise({
        try: () => setChatPref(chatId, input),
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setActionFor((current) => (current === chatId ? null : current));
            setActionMuteOpen(false);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError('Could not save. Try again.');
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            prefInFlight.current.delete(chatId);
            setPrefBusy((busy) => withKey(busy, chatId, false));
          }),
        ),
      ),
    );
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
  // Only a handle the lookup accepts switches to the People view; a bare `@`
  // keeps showing the normal chat list.
  const peopleSearch = peopleHandleFor(search) !== null;
  const chatMatches = searchChat === undefined ? chatSearchMatches(visibleRows) : [];
  const { api: contactsApi } = useContactsApi();

  const searchHeader = searchOpen ? (
    <View className="flex-row items-center gap-3 px-4 py-2">
      <SearchField
        containerClassName="flex-1"
        autoFocus
        value={search}
        onChangeText={onSearchChange}
        onSubmitEditing={() => setSubmitRequest((count) => count + 1)}
        placeholder="Search, or type @username"
        accessibilityLabel="Search chats, messages and people"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        onClear={() => onSearchChange('')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel search"
        onPress={closeSearch}
      >
        <Text className="text-[15px] text-foreground">Cancel</Text>
      </Pressable>
    </View>
  ) : (
    <View className="gap-2 px-4 py-2">
      <Text className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">
        Chats
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search chats and @usernames"
        onPress={() => setSearchOpen(true)}
        className="h-10 flex-row items-center gap-2 rounded-xl px-3"
        style={well}
      >
        <Search size={16} color={MUTED_FOREGROUND[scheme]} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          className="flex-1 text-[15px]"
          style={{ color: MUTED_FOREGROUND[scheme] }}
        >
          Search chats and @usernames
        </Text>
      </Pressable>
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
        {chatMatches.length > 0 ? (
          <View className="px-2">
            <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
              Chats
            </Text>
            {chatMatches.map((row) =>
              row.kind === 'chat' ? (
                <ChatListItem
                  key={row.chat.id}
                  chat={row.chat}
                  onPress={() => {
                    closeSearch();
                    router.push({ pathname: '/chat/[id]', params: { id: row.chat.id } });
                  }}
                  onLongPress={() => openActions(row.chat.id)}
                />
              ) : (
                <GroupListItem
                  key={`group:${row.groupId}`}
                  groupId={row.groupId}
                  onPress={() => {
                    closeSearch();
                    router.push({ pathname: '/group/[id]', params: { id: row.groupId } });
                  }}
                  onLongPress={() => openActions(`group:${row.groupId}`)}
                />
              ),
            )}
          </View>
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

  // A valid `@handle` shows only the People section: chat names rarely
  // contain `@`, and the normal list stays reachable by removing the `@`.
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
      <FolderTabs
        activeFolder={activeFolder}
        folders={folders}
        counts={counts}
        onSelect={setActiveFolder}
      />
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
        contentContainerStyle={{ paddingBottom: 180 }}
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
            : saveChatPref(actionContext.chat.id, {
                mutedUntil: mutedUntilFor(duration, new Date()),
              })
        }
        onUnmute={() =>
          actionContext?.chat === undefined
            ? undefined
            : saveChatPref(actionContext.chat.id, { mutedUntil: null })
        }
        onTogglePin={() =>
          actionContext?.chat === undefined
            ? undefined
            : saveChatPref(actionContext.chat.id, {
                pinned: actionContext.chat.pinnedAt === undefined,
              })
        }
        onToggleArchive={() =>
          actionContext?.chat === undefined
            ? undefined
            : saveChatPref(actionContext.chat.id, {
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
