import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { Archive, MessageSquarePlus } from 'lucide-react-native';
import { useMemo, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { LoadError } from '@/components/chat/load-error';
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

type ChatListPageProps = {
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
};

// Rows stay plain while the tabs are up: the pager owns horizontal drags.
export function ChatListPage({
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
}: ChatListPageProps) {
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
