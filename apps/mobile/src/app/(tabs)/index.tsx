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
import { peopleHandleFor } from '@zilar/client-core';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { connectionLabel } from '@/lib/connection';
import { chatListModel, chatSearchMatches } from '@/lib/chat-list';
import { unreadCount } from '@/lib/filter';
import { useDelayed } from '@zilar/client-core';
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
  const myUserId = useChatStore((state) => state.currentUserId);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const search = useChatStore((state) => state.search);
  const setSearch = useChatStore((state) => state.setSearch);
  const activeFolder = useChatStore((state) => state.activeFolder);
  const setActiveFolder = useChatStore((state) => state.setActiveFolder);
  const folders = useChatStore((state) => state.folders);
  const status = useChatStore((state) => state.status);
  const connection = useDelayed(connectionLabel(status), 1500);
  const me = useChatStore((state) => state.me);
  const [searchOpen, setSearchOpen] = useState(false);
  // Enter bumps `submitRequest`, so the `@handle` lookup fires at once instead of waiting out the debounce.
  const [submitRequest, setSubmitRequest] = useState(0);
  const searchChatParam = typeof params.searchChat === 'string' ? params.searchChat : undefined;
  const [searchChat, setSearchChat] = useState<string | undefined>(undefined);
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
  const [searchMiss, setSearchMiss] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const actions = useChatActions();
  const [lastChatsLoad, setLastChatsLoad] = useState(chatsLoad);
  if (chatsLoad !== lastChatsLoad) {
    setLastChatsLoad(chatsLoad);
    if (refreshing && chatsLoad !== 'loading') {
      setRefreshing(false);
    }
  }

  const activeFolderDef = useMemo(
    () =>
      activeFolder === 'all' ? undefined : folders.find((folder) => folder.id === activeFolder),
    [activeFolder, folders],
  );
  const { rows: visibleRows } = useMemo(
    () => chatListModel(chats, { folder: activeFolderDef, search, myUserId }),
    [chats, activeFolderDef, search, myUserId],
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

  // 2+ characters searches message text across every visible chat below the name matches; a shorter query keeps filtering chat names.
  const messageQuery = search.trim().length >= 2 ? search : null;
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
        onOpenGroup={openSearchGroup}
        chatMatches={chatMatches}
        openActions={actions.openActions}
        messageQuery={messageQuery}
        onNotFound={() => setSearchMiss(messageQuery)}
        searchMiss={searchMiss}
      />
    );
  }

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
        chats={chats}
        search={search}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          reloadChats();
        }}
        archivedOpen={archivedOpen}
        onToggleArchived={() => setArchivedOpen((value) => !value)}
        onPressChat={(chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } })}
        onPressGroup={(groupId) =>
          router.push({ pathname: '/group/[id]', params: { id: groupId } })
        }
        onLongPress={actions.openActions}
        swipeError={actions.swipeError}
        onStartChat={() => setSearchOpen(true)}
        onRequestsToast={setToast}
      />
      <ChatActionsHost
        actions={actions}
        onOpenGroup={(groupId) => router.push({ pathname: '/group/[id]', params: { id: groupId } })}
      />
      <NewChatButton />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}
