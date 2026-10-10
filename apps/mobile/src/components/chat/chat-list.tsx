import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { Archive } from 'lucide-react-native';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { LoadError, LoadErrorBanner } from '@/components/chat/load-error';
import { ChatListSkeleton } from '@/components/chat/skeleton';
import { Text } from '@/components/ui/text';
import type { ChatListRow } from '@/lib/chat-list';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { chatsListView, emptyChatsText, type LoadState } from '@/store/types';

/**
 * The chats list body (T-0112, T-0135): folder chips, the connection line, the
 * FlatList of chat/group rows with its skeleton, empty and error states, and
 * the Archived entry at the bottom. The screen owns the load and search state.
 */
export function ChatList({
  activeFolder,
  folders,
  counts,
  onSelectFolder,
  connection,
  chatsLoad,
  chatsCount,
  onRetry,
  rows,
  refreshing,
  onRefresh,
  archived,
  archivedOpen,
  onToggleArchived,
  onPressChat,
  onPressGroup,
  onLongPress,
}: {
  activeFolder: string;
  folders: ChatFolder[];
  counts: Record<string, number>;
  onSelectFolder: (folder: string) => void;
  connection: string | undefined;
  chatsLoad: LoadState;
  chatsCount: number;
  onRetry: () => void;
  rows: ChatListRow[];
  refreshing: boolean;
  onRefresh: () => void;
  archived: ChatSummary[];
  archivedOpen: boolean;
  onToggleArchived: () => void;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
}) {
  const listView = chatsListView(chatsLoad, chatsCount);
  return (
    <>
      <FolderTabs
        activeFolder={activeFolder}
        folders={folders}
        counts={counts}
        onSelect={onSelectFolder}
      />
      {connection !== undefined ? (
        <View className="border-b border-divider px-3 py-1">
          <Text className="text-center text-[12px] text-muted-foreground">{connection}</Text>
        </View>
      ) : null}
      {chatsLoad === 'error' && chatsCount > 0 ? (
        <LoadErrorBanner message="Couldn't load chats" onRetry={onRetry} />
      ) : null}
      <FlatList
        className="flex-1"
        data={rows}
        keyExtractor={chatRowKey}
        contentContainerStyle={{ paddingBottom: 180 }}
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
            <LoadError message="Couldn't load chats" onRetry={onRetry} />
          ) : (
            <View className="items-center px-6 pt-16">
              <Text className="text-[15px] text-muted-foreground">
                {emptyChatsText(chatsCount)}
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
      ) : null}
    </>
  );
}
