import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { Archive, MessageSquarePlus } from 'lucide-react-native';
import { useMemo, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { FolderPager } from '@/components/chat/folder-pager';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { LoadError, LoadErrorBanner } from '@/components/chat/load-error';
import { ContactRequestRows } from '@/components/chat/request-rows';
import { ChatListSkeleton } from '@/components/chat/skeleton';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { ToastMessage } from '@/components/ui/toast';
import { chatListModel, type ChatListRow } from '@/lib/chat-list';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { useScrollToTopOnReselect } from '@/lib/tab-reselect';
import { useChatStore } from '@/store/chat-store-provider';
import { chatsListView, emptyChatsText, type LoadState } from '@/store/types';

export function ChatList({
  activeFolder,
  folders,
  counts,
  onSelectFolder,
  connection,
  chatsLoad,
  chatsCount,
  onRetry,
  chats,
  search,
  refreshing,
  onRefresh,
  archivedOpen,
  onToggleArchived,
  onPressChat,
  onPressGroup,
  onLongPress,
  swipeError,
  onStartChat,
  onRequestsToast,
}: {
  activeFolder: string;
  folders: ChatFolder[];
  counts: Record<string, number>;
  onSelectFolder: (folder: string) => void;
  connection: string | undefined;
  chatsLoad: LoadState;
  chatsCount: number;
  onRetry: () => void;
  chats: ChatSummary[];
  search: string;
  refreshing: boolean;
  onRefresh: () => void;
  archivedOpen: boolean;
  onToggleArchived: () => void;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  swipeError: string;
  onStartChat?: (() => void) | undefined;
  onRequestsToast: (toast: ToastMessage) => void;
}) {
  const chipIds = ['all', ...folders.map((folder) => folder.id)];
  const index = Math.max(0, chipIds.indexOf(activeFolder));
  const progress = useSharedValue(index);

  const renderPage = (page: number) => (
    <ChatListPage
      folder={page === 0 ? undefined : folders[page - 1]}
      chats={chats}
      search={search}
      chatsLoad={chatsLoad}
      chatsCount={chatsCount}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onRetry={onRetry}
      archivedOpen={archivedOpen}
      onToggleArchived={onToggleArchived}
      onPressChat={onPressChat}
      onPressGroup={onPressGroup}
      onLongPress={onLongPress}
      onStartChat={onStartChat}
      onRequestsToast={onRequestsToast}
    />
  );

  return (
    <>
      <FolderTabs
        activeFolder={activeFolder}
        folders={folders}
        counts={counts}
        progress={progress}
        onSelect={onSelectFolder}
      />
      <View className="flex-1">
        {connection !== undefined ? (
          <View pointerEvents="none" className="absolute left-0 right-0 top-2 z-10 items-center">
            <View className="rounded-full border border-divider bg-surface-raised px-3 py-1">
              <Text accessibilityLiveRegion="polite" className="text-[12px] text-muted-foreground">
                {connection}
              </Text>
            </View>
          </View>
        ) : null}
        {swipeError !== '' || (chatsLoad === 'error' && chatsCount > 0) ? (
          <View
            pointerEvents="box-none"
            className="absolute bottom-3 left-0 right-0 z-10 items-center gap-2 px-3"
          >
            {swipeError !== '' ? (
              <View className="rounded-full border border-divider bg-surface-raised px-3 py-1">
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-center text-[12px] text-danger"
                >
                  {swipeError}
                </Text>
              </View>
            ) : null}
            {chatsLoad === 'error' && chatsCount > 0 ? (
              <LoadErrorBanner message="Could not load chats. Try again." onRetry={onRetry} />
            ) : null}
          </View>
        ) : null}
        <FolderPager
          count={folders.length + 1}
          index={index}
          progress={progress}
          onIndexChange={(page) =>
            onSelectFolder(page === 0 ? 'all' : (folders[page - 1]?.id ?? 'all'))
          }
          renderPage={renderPage}
        />
      </View>
    </>
  );
}

// Rows stay plain while the tabs are up: the pager owns horizontal drags.
function ChatListPage({
  folder,
  chats,
  search,
  chatsLoad,
  chatsCount,
  refreshing,
  onRefresh,
  onRetry,
  archivedOpen,
  onToggleArchived,
  onPressChat,
  onPressGroup,
  onLongPress,
  onStartChat,
  onRequestsToast,
}: {
  folder: ChatFolder | undefined;
  chats: ChatSummary[];
  search: string;
  chatsLoad: LoadState;
  chatsCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  archivedOpen: boolean;
  onToggleArchived: () => void;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  onStartChat?: (() => void) | undefined;
  onRequestsToast: (toast: ToastMessage) => void;
}) {
  const myUserId = useChatStore((state) => state.currentUserId);
  const listRef = useRef<FlatList<ChatListRow>>(null);
  useScrollToTopOnReselect('index', () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  });
  const { rows, archived } = useMemo(
    () => chatListModel(chats, { folder, search, myUserId }),
    [chats, folder, search, myUserId],
  );
  const listView = chatsListView(chatsLoad, chatsCount);
  const showRequests = folder === undefined || folder.includeTypes.includes('dm');
  return (
    <FlatList
      ref={listRef}
      className="flex-1"
      data={rows}
      keyExtractor={chatRowKey}
      contentContainerStyle={{ paddingBottom: 180 }}
      ListHeaderComponent={showRequests ? <ContactRequestRows onToast={onRequestsToast} /> : null}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={MUTED_FOREGROUND}
          onRefresh={onRefresh}
        />
      }
      renderItem={({ item }) => (
        <ChatRow
          row={item}
          onPressChat={onPressChat}
          onPressGroup={onPressGroup}
          onLongPress={onLongPress}
        />
      )}
      ListEmptyComponent={
        listView === 'skeleton' ? (
          <ChatListSkeleton />
        ) : listView === 'error' ? (
          <LoadError message="Could not load chats. Try again." onRetry={onRetry} />
        ) : (
          <StateMessage
            kind="empty"
            icon={MessageSquarePlus}
            title={emptyChatsText(chatsCount)}
            hint={
              chatsCount === 0
                ? 'Start a chat to see it here.'
                : 'Try a different folder or search.'
            }
            action={
              chatsCount === 0 && onStartChat !== undefined
                ? { label: 'Start a chat', onPress: onStartChat }
                : undefined
            }
          />
        )
      }
      ListFooterComponent={
        archived.length > 0 ? (
          <View className="border-t border-divider">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                archivedOpen ? 'Hide archived chats' : `Show archived chats, ${archived.length}`
              }
              onPress={onToggleArchived}
              className="flex-row items-center justify-center gap-1.5 px-4 py-3 active:bg-surface-raised"
            >
              <Archive size={16} color={ICON} />
              <Text className="text-[14px] font-medium text-muted-foreground">
                Archived ({archived.length})
              </Text>
            </Pressable>
            {archivedOpen
              ? archived.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    row={{ kind: 'chat', chat }}
                    onPressChat={onPressChat}
                    onPressGroup={onPressGroup}
                    onLongPress={onLongPress}
                  />
                ))
              : null}
          </View>
        ) : null
      }
    />
  );
}
