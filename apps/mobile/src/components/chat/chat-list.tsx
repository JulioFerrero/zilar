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

/**
 * The chats list body (T-0112, T-0135): the folder tabs over a horizontal
 * pager, the connection pill floating over the pager, the error banners, and
 * the Archived entry inside each page. The screen owns the load, search and refresh state. T-1310: the
 * pager (gesture-handler + reanimated) slides between the folders and the tabs
 * follow it; only the visible page and its neighbours render. The rows inside
 * the pager are plain: while the folder tabs are up the pager owns horizontal
 * drags, and Pin/Mute/Archive stay on the long-press sheet.
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
  /** T-1218: a failed swipe's message; empty unless a swipe just failed. */
  swipeError: string;
  /** T-1289: opens the new-chat flow from the empty state. */
  onStartChat?: (() => void) | undefined;
  /** T-1336: shows the request rows' transient messages on the screen toast. */
  onRequestsToast: (toast: ToastMessage) => void;
}) {
  const chipIds = ['all', ...folders.map((folder) => folder.id)];
  const index = Math.max(0, chipIds.indexOf(activeFolder));
  // The continuous page position, owned by the pager and read by the tabs.
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
        {swipeError !== '' ? (
          <View className="border-b border-divider px-3 py-1">
            <Text accessibilityLiveRegion="polite" className="text-center text-[12px] text-danger">
              {swipeError}
            </Text>
          </View>
        ) : null}
        {chatsLoad === 'error' && chatsCount > 0 ? (
          <LoadErrorBanner message="Could not load chats. Try again." onRetry={onRetry} />
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
