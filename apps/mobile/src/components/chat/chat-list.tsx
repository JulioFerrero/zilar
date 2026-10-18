import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ChatListPage } from '@/components/chat/chat-list-page';
import { FolderPager } from '@/components/chat/folder-pager';
import { FolderTabs } from '@/components/chat/folder-tabs';
import { LoadErrorBanner } from '@/components/chat/load-error';
import { Text } from '@/components/ui/text';
import type { ToastMessage } from '@/components/ui/toast';
import type { LoadState } from '@/store/types';

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
