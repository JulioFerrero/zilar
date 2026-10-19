import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { Archive, MessagesSquare, MessageSquarePlus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { folderIcon } from '@/components/chat/folder-icon';
import { LoadError, LoadErrorBanner } from '@/components/chat/load-error';
import { ContactRequestRows } from '@/components/chat/request-rows';
import { ChatListSkeleton } from '@/components/chat/skeleton';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { ToastMessage } from '@/components/ui/toast';
import { chatListModel, type ChatListRow } from '@/lib/chat-list';
import { FOREGROUND, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { segment, well } from '@/lib/depth';
import { cn } from '@/lib/utils';
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

const COMMIT_DISTANCE = 60;
const COMMIT_VELOCITY = 500;
const EDGE_RESISTANCE = 0.35;
const SETTLE_MS = 240;

type PagerMotion = {
  translateX: SharedValue<number>;
  startX: SharedValue<number>;
  progress: SharedValue<number>;
};

function animateToPage(motion: PagerMotion, page: number, width: number): void {
  'worklet';
  motion.translateX.value = withTiming(-page * width, { duration: SETTLE_MS });
  motion.progress.value = withTiming(page, { duration: SETTLE_MS });
}

/** On release past the distance or flick it settles on the next page and
 *  reports it; a cancelled drag snaps to the nearest page, never stranded. */
function makePan(
  motion: PagerMotion,
  count: number,
  width: number,
  onIndexChange: (index: number) => void,
) {
  return Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart(() => {
      motion.startX.value = motion.translateX.value;
    })
    .onUpdate((event) => {
      const min = -(count - 1) * width;
      const raw = motion.startX.value + event.translationX;
      if (raw > 0) {
        motion.translateX.value = raw * EDGE_RESISTANCE;
      } else if (raw < min) {
        motion.translateX.value = min + (raw - min) * EDGE_RESISTANCE;
      } else {
        motion.translateX.value = raw;
      }
      motion.progress.value = -motion.translateX.value / width;
    })
    .onEnd((event, success) => {
      if (!success) {
        return;
      }
      const base = Math.round(-motion.startX.value / width);
      let target = base;
      if (event.translationX < -COMMIT_DISTANCE || event.velocityX < -COMMIT_VELOCITY) {
        target = base + 1;
      } else if (event.translationX > COMMIT_DISTANCE || event.velocityX > COMMIT_VELOCITY) {
        target = base - 1;
      }
      target = Math.max(0, Math.min(count - 1, target));
      animateToPage(motion, target, width);
      if (target !== base) {
        runOnJS(onIndexChange)(target);
      }
    })
    .onFinalize((_event, success) => {
      if (success) {
        return;
      }
      // A cancelled or failed drag snaps to the nearest page: the track and the tabs
      // must never stay stranded between pages.
      const target = Math.max(0, Math.min(count - 1, Math.round(-motion.translateX.value / width)));
      animateToPage(motion, target, width);
    });
}

/** Keeps a callback's identity stable while it always calls the latest closure. */
function useStableIndexChange(onIndexChange: (index: number) => void): (index: number) => void {
  const latest = useRef(onIndexChange);
  useEffect(() => {
    latest.current = onIndexChange;
  });
  return useMemo(() => (index: number) => latest.current(index), []);
}

type FolderPagerProps = {
  count: number;
  index: number;
  progress: SharedValue<number>;
  onIndexChange: (index: number) => void;
  renderPage: (index: number) => ReactNode;
};

/** Only the visible page and its immediate neighbours render their lists. */
function FolderPager({ count, index, progress, onIndexChange, renderPage }: FolderPagerProps) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(-index * width);
  const startX = useSharedValue(-index * width);
  // A plain object so worklets read and write the shared values through it.
  const motion = useMemo<PagerMotion>(
    () => ({ translateX, startX, progress }),
    [translateX, startX, progress],
  );

  useEffect(() => {
    animateToPage(motion, index, width);
    // Rebuilding the pan mid-drag would drop the gesture, so it reads the latest
    // `onIndexChange` through a stable callback.
  }, [index, width, motion]);

  const handleIndexChange = useStableIndexChange(onIndexChange);

  const pan = useMemo(
    () => makePan(motion, count, width, handleIndexChange),
    [motion, count, width, handleIndexChange],
  );
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: motion.translateX.value }],
  }));

  const first = Math.max(0, index - 1);
  const last = Math.min(count - 1, index + 1);
  const pages: ReactNode[] = [];
  for (let page = first; page <= last; page += 1) {
    pages.push(
      <Animated.View
        key={page}
        style={{ position: 'absolute', top: 0, bottom: 0, left: page * width, width }}
      >
        {renderPage(page)}
      </Animated.View>,
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View style={[{ flex: 1, width: count * width }, trackStyle]}>
          {pages}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const ROW_INSET = 16;

const TRACK_PADDING = 3;

type FolderChip = {
  id: string;
  name: string;
  folder: ChatFolder | undefined;
};

type FolderTabsProps = {
  activeFolder: string;
  folders: ChatFolder[];
  counts: Record<string, number>;
  progress: SharedValue<number>;
  onSelect: (folder: string) => void;
};

function chipGlyph(folder: ChatFolder | undefined, color: string) {
  if (folder === undefined) {
    return <MessagesSquare size={14} color={color} />;
  }
  const Icon = folderIcon(folder.icon);
  return <Icon size={14} color={color} />;
}

function FolderTabs({ activeFolder, folders, counts, progress, onSelect }: FolderTabsProps) {
  const chips: FolderChip[] = [
    { id: 'all', name: 'All chats', folder: undefined },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, folder })),
  ];
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Record<string, { x: number; width: number }>>({});

  const scrollToActive = useCallback((id: string) => {
    const position = positions.current[id];
    if (position !== undefined) {
      scrollRef.current?.scrollTo({
        x: Math.max(0, position.x - TRACK_PADDING),
        animated: true,
      });
    }
  }, []);

  useEffect(() => {
    scrollToActive(activeFolder);
  }, [activeFolder, scrollToActive]);

  const recordLayout = (chip: FolderChip, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    positions.current[chip.id] = { x, width };
    if (chip.id === activeFolder) {
      scrollToActive(chip.id);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView grows to fill the free height; without
      // `flex-y-0` it eats the screen.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        flexDirection: 'row',
        paddingHorizontal: ROW_INSET,
        paddingBottom: 8,
      }}
    >
      <View
        className="flex-row gap-0.5 rounded-[10px] p-[3px]"
        style={[well, { borderColor: '#1a1a1a' }]}
      >
        {chips.map((chip, index) => (
          <FolderChipView
            key={chip.id}
            chip={chip}
            index={index}
            selected={chip.id === activeFolder}
            count={counts[chip.id] ?? 0}
            progress={progress}
            onSelect={() => onSelect(chip.id)}
            onLayout={(event) => recordLayout(chip, event)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

type FolderChipViewProps = {
  chip: FolderChip;
  index: number;
  selected: boolean;
  count: number;
  progress: SharedValue<number>;
  onSelect: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
};

function FolderChipView({
  chip,
  index,
  selected,
  count,
  progress,
  onSelect,
  onLayout,
}: FolderChipViewProps) {
  const raisedStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - Math.abs(progress.value - index)),
  }));
  const iconColor = selected ? FOREGROUND : MUTED_FOREGROUND;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={chip.name}
      onPress={onSelect}
      onLayout={onLayout}
      className="h-[34px] flex-row items-center gap-1.5 overflow-hidden rounded-[7px] px-3"
    >
      <Animated.View
        className="absolute inset-0 rounded-[7px]"
        style={[segment, raisedStyle]}
        pointerEvents="none"
      />
      {chipGlyph(chip.folder, iconColor)}
      <Text
        className={cn(
          'text-[13px] font-medium',
          selected ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {chip.name}
      </Text>
      {count > 0 ? (
        <View
          className={cn(
            'min-w-[16px] items-center justify-center rounded-full px-1',
            selected ? 'bg-accent' : 'bg-surface',
          )}
        >
          <Text
            className={cn(
              'font-mono text-[10px] leading-4',
              selected ? 'text-accent-foreground' : 'text-muted-foreground',
            )}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
