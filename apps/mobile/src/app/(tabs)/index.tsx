import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAuth } from '@/auth/RequireAuth';
import { ChatList } from '@/components/chat/chat-list';
import { ChatPeopleResults, ChatSearchResults } from '@/components/chat/chat-search-results';
import { NewChatButton } from '@/components/chat/new-chat-button';
import { interruptFiber, peopleHandleFor, useDelayed } from '@zilar/client-core';
import { withKey, mutedUntilFor } from '@zilar/chat-core';
import { Effect, type Fiber } from 'effect';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { connectionLabel } from '@/lib/connection';
import { chatListModel, chatSearchMatches } from '@/lib/chat-list';
import { unreadCount } from '@/lib/filter';
import { topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';
import { Search } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { ChatActionsSheet } from '@/components/chat/chat-actions-sheet';

// How long a failed swipe keeps its line above the chat list.
const SWIPE_ERROR_MS = 4000;
const DELETE_ERROR = 'Could not delete. Try again.';

// The chats screen's header: the title and search well when search is closed, the autofocused field with Cancel when open. The screen owns the search state.
function SearchHeader({
  searchOpen,
  search,
  onChange,
  onSubmit,
  onOpen,
  onCancel,
}: {
  searchOpen: boolean;
  search: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpen: () => void;
  onCancel: () => void;
}) {
  if (searchOpen) {
    return (
      <View className="flex-row items-center gap-3 px-4 py-2">
        <SearchField
          containerClassName="flex-1"
          autoFocus
          value={search}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          placeholder="Search, or type @username"
          accessibilityLabel="Search chats, messages and people"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          onClear={() => onChange('')}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel search" onPress={onCancel}>
          <Text className="text-[15px] text-foreground">Cancel</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="pb-2">
      <ScreenHeader variant="root" title="Chats" />
      <View className="px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search chats and @usernames"
          onPress={onOpen}
          className="h-10 flex-row items-center gap-2 rounded-xl px-3"
          style={well}
        >
          <Search size={16} color={MUTED_FOREGROUND} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="flex-1 text-[15px]"
            style={{ color: MUTED_FOREGROUND }}
          >
            Search chats and @usernames
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

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
  // The chat id (or `group:<groupId>`) whose action sheet is open; the sheet resolves it to the rows below.
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [actionMuteOpen, setActionMuteOpen] = useState(false);
  const [actionClearOpen, setActionClearOpen] = useState(false);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const markChatRead = useChatStore((state) => state.markChatRead);
  const clearHistory = useChatStore((state) => state.clearHistory);
  const [actionError, setActionError] = useState('');
  // One timer clears the swipe-failure line; a new save or unmount cancels it.
  const swipeErrorTimer = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
  const cancelSwipeErrorTimer = () => {
    interruptFiber(swipeErrorTimer.current);
    swipeErrorTimer.current = undefined;
  };
  useEffect(
    () => () => {
      interruptFiber(swipeErrorTimer.current);
    },
    [],
  );
  // One change per chat at a time: a second tap while it saves is dropped, other chats are not blocked.
  const prefInFlight = useRef(new Set<string>());
  const [prefBusy, setPrefBusy] = useState<ReadonlySet<string>>(() => new Set());

  const openActions = (id: string) => {
    setActionMuteOpen(false);
    setActionClearOpen(false);
    setActionError('');
    setActionFor(id);
  };

  // The rows behind the sheet: a group resolves to its General topic row. Only a General row enables the pref rows, since a group pref on any other JID would mute one topic, not the group.
  const actionContext = useMemo(() => {
    if (actionFor === null) {
      return undefined;
    }
    if (actionFor.startsWith('group:')) {
      const actionGroupId = actionFor.slice('group:'.length);
      const topics = topicsOfGroup(chats, actionGroupId);
      const general = topics.find((topic) => topic.topic?.isGeneral === true);
      const fallback = general ?? topics[0];
      const groupTitle = general?.groupTitle ?? fallback?.groupTitle ?? fallback?.title ?? 'Group';
      return { chat: general, groupId: actionGroupId, groupTitle };
    }
    const chat = chats.find((entry) => entry.id === actionFor);
    return chat === undefined ? undefined : { chat, groupId: undefined, groupTitle: undefined };
  }, [actionFor, chats]);

  const actionChatId = actionContext?.chat?.id;
  const actionBusy = actionChatId !== undefined && prefBusy.has(actionChatId);
  // With no sheet open a save failure belongs to the swipe and shows on its own line; with the sheet open, the sheet shows it.
  const swipeError = actionFor === null ? actionError : '';

  // A saving chat change closes its sheet; a failure keeps it open. `save` is the write itself, so a pref patch, Mark as read and Clear history share one path; `errorText` is the fixed failure line.
  const runPrefSave = (
    saveChatId: string,
    save: () => Promise<void>,
    errorText = 'Could not save. Try again.',
  ) => {
    if (prefInFlight.current.has(saveChatId)) {
      return;
    }
    prefInFlight.current.add(saveChatId);
    setPrefBusy((busy) => withKey(busy, saveChatId, true));
    cancelSwipeErrorTimer();
    setActionError('');
    Effect.runFork(
      Effect.tryPromise({
        try: save,
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setActionFor((current) => (current === saveChatId ? null : current));
            setActionMuteOpen(false);
            setActionClearOpen(false);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError(errorText);
            // A swipe has no sheet to show it in: keep the line for a beat.
            if (actionFor === null) {
              swipeErrorTimer.current = Effect.runFork(
                Effect.sleep(SWIPE_ERROR_MS).pipe(
                  Effect.andThen(Effect.sync(() => setActionError(''))),
                ),
              );
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            prefInFlight.current.delete(saveChatId);
            setPrefBusy((busy) => withKey(busy, saveChatId, false));
          }),
        ),
      ),
    );
  };

  const saveChatPref = (chatId: string, input: Parameters<typeof setChatPref>[1]) => {
    runPrefSave(chatId, () => setChatPref(chatId, input));
  };

  // "Mark as unread" sets the manual pref; "Mark as read" runs the store action (recordRead plus clearing the pref).
  const markUnread = (chatId: string) =>
    runPrefSave(chatId, () => setChatPref(chatId, { unreadMark: true }));
  const markRead = (chatId: string) => runPrefSave(chatId, () => markChatRead(chatId));

  // Clear history runs the store action (my own copy only) and keeps the row; only `failed` shows the delete line.
  const clearHistoryFor = (chatId: string) => {
    setActionClearOpen(false);
    runPrefSave(
      chatId,
      () =>
        clearHistory(chatId).then((outcome) => {
          if (outcome === 'failed') {
            throw new Error('clear_history_failed');
          }
        }),
      DELETE_ERROR,
    );
  };

  const closeActions = () => {
    if (!actionBusy) {
      setActionFor(null);
      setActionMuteOpen(false);
      setActionClearOpen(false);
      setActionError('');
    }
  };

  const openClear = () => setActionClearOpen(true);
  const closeClear = () => setActionClearOpen(false);

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
        openActions={openActions}
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
        onLongPress={openActions}
        swipeError={swipeError}
        onStartChat={() => setSearchOpen(true)}
        onRequestsToast={setToast}
      />
      <ChatActionsSheet
        chat={actionContext?.chat ?? null}
        groupTitle={actionContext?.groupTitle}
        groupId={actionContext?.groupId}
        busy={actionBusy}
        error={actionError}
        muteOpen={actionMuteOpen}
        clearOpen={actionClearOpen}
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
        onMarkUnread={() =>
          actionContext?.chat === undefined ? undefined : markUnread(actionContext.chat.id)
        }
        onMarkRead={() =>
          actionContext?.chat === undefined ? undefined : markRead(actionContext.chat.id)
        }
        onOpenClear={openClear}
        onClearHistory={() =>
          actionContext?.chat === undefined ? undefined : clearHistoryFor(actionContext.chat.id)
        }
        onCancelClear={closeClear}
        onOpenGroup={(groupId) => {
          closeActions();
          router.push({ pathname: '/group/[id]', params: { id: groupId } });
        }}
        onClose={closeActions}
      />
      <NewChatButton />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}
