import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatActionsHost } from '@/components/chat/chat-actions-host';
import { ChatList } from '@/components/chat/chat-list';
import { ChatPeopleResults, ChatSearchResults } from '@/components/chat/chat-search-results';
import { NewChatButton } from '@/components/chat/new-chat-button';
import { SearchHeader } from '@/components/chat/search-header';
import { useChatActions } from '@/components/chat/use-chat-actions';
import { peopleHandleFor } from '@/components/contacts/people-search';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { connectionLabel } from '@/lib/connection';
import { chatListModel, chatSearchMatches } from '@/lib/chat-list';
import { unreadCount } from '@/lib/filter';
import { useChatStore } from '@/store/chat-store-provider';

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
  const [refreshing, setRefreshing] = useState(false);
  // A search hit that lands nowhere ("Message not found"): the chat still
  // opens at its bottom; the inline notice says the message is not there.
  const [searchMiss, setSearchMiss] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const actions = useChatActions();
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
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: unreadCount(chats, undefined) };
    for (const folder of folders) {
      next[folder.id] = unreadCount(chats, folder);
    }
    return next;
  }, [chats, folders]);

  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
    setSearchMiss(null);
    setSearchChat(undefined);
    setSubmitRequest(0);
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

  const searchHeader = (
    <SearchHeader
      searchOpen={searchOpen}
      search={search}
      onChange={onSearchChange}
      onSubmit={() => setSubmitRequest((count) => count + 1)}
      onOpen={() => setSearchOpen(true)}
      onCancel={closeSearch}
    />
  );

  const openChat = (chatId: string) => {
    closeSearch();
    router.push({ pathname: '/chat/[id]', params: { id: chatId } });
  };

  const openRequests = () => {
    closeSearch();
    router.push('/settings/requests');
  };

  const openSearchGroup = (groupId: string) => {
    closeSearch();
    router.push({ pathname: '/group/[id]', params: { id: groupId } });
  };

  if (searchOpen && messageQuery !== null) {
    return (
      <ChatSearchResults
        searchHeader={searchHeader}
        searchChat={searchChat}
        searchChatTitle={searchChatTitle}
        onClearSearchChat={() => setSearchChat(undefined)}
        peopleSearch={peopleSearch}
        contactsApi={contactsApi}
        search={search}
        chats={chats}
        myJid={me?.jid ?? undefined}
        submitRequest={submitRequest}
        onOpenChat={openChat}
        onOpenRequests={openRequests}
        onOpenGroup={openSearchGroup}
        chatMatches={chatMatches}
        openActions={actions.openActions}
        messageQuery={messageQuery}
        onNotFound={() => setSearchMiss(messageQuery)}
        searchMiss={searchMiss}
      />
    );
  }

  // A valid `@handle` shows only the People section: chat names rarely
  // contain `@`, and the normal list stays reachable by removing the `@`.
  if (searchOpen && peopleSearch) {
    return (
      <ChatPeopleResults
        searchHeader={searchHeader}
        contactsApi={contactsApi}
        search={search}
        chats={chats}
        myJid={me?.jid ?? undefined}
        submitRequest={submitRequest}
        onOpenChat={openChat}
        onOpenRequests={openRequests}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {searchHeader}
      <ChatList
        activeFolder={activeFolder}
        folders={folders}
        counts={counts}
        onSelectFolder={setActiveFolder}
        connection={connection}
        chatsLoad={chatsLoad}
        chatsCount={chats.length}
        onRetry={reloadChats}
        rows={visibleRows}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          reloadChats();
        }}
        archived={archived}
        archivedOpen={archivedOpen}
        onToggleArchived={() => setArchivedOpen((value) => !value)}
        onPressChat={(chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } })}
        onPressGroup={(groupId) =>
          router.push({ pathname: '/group/[id]', params: { id: groupId } })
        }
        onLongPress={actions.openActions}
      />
      <ChatActionsHost
        actions={actions}
        onOpenGroup={(groupId) => router.push({ pathname: '/group/[id]', params: { id: groupId } })}
      />
      <NewChatButton />
    </SafeAreaView>
  );
}
