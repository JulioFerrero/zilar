import { formatDuration, formatShortDate } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { BottomSheet } from '../ui/bottom-sheet';
import { useChatStore } from '../../store/chat-store-provider';
import { Button } from '../ui/button';
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control';
import { StateMessage } from '../ui/state-message';
import { Text } from '../ui/text';
import type { MediaItem, MediaTab } from '@zilar/api-contract';

/** The gallery tab labels, in the order the segmented control shows them. */
const TAB_OPTIONS: SegmentedOption[] = [
  { value: 'media', label: 'Media' },
  { value: 'files', label: 'Files' },
  { value: 'links', label: 'Links' },
  { value: 'voice', label: 'Voice' },
];

const MEDIA_EMPTY_TEXT: Record<MediaTab, string> = {
  media: 'No media yet',
  files: 'No files yet',
  links: 'No links yet',
  voice: 'No voice messages yet',
};

const MEDIA_LOADING_TEXT = 'Loading media…';
const MEDIA_LOAD_ERROR_TEXT = 'Could not load media. Try again.';

type MediaSheetStatus = 'loading' | 'error' | 'ready';

interface MediaSheetContentProps {
  tab: MediaTab;
  status: MediaSheetStatus;
  items: MediaItem[];
  next: string | null;
  loadingMore: boolean;
  error: string;
  onSelectTab: (tab: MediaTab) => void;
  onShowInChat: (item: MediaItem) => void;
  onOpenLink: (url: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

// The gallery's pure view: tabs, grid or per-tab rows, empty/loading/error states and Load more. The connected `MediaSheet` owns the load; this stays hook-free so tests render it directly.
function MediaSheetContent({
  tab,
  status,
  items,
  next,
  loadingMore,
  error,
  onSelectTab,
  onShowInChat,
  onOpenLink,
  onLoadMore,
  onRetry,
}: MediaSheetContentProps) {
  const showRows = status === 'ready' && items.length > 0;
  return (
    <View>
      <SegmentedControl
        options={TAB_OPTIONS}
        value={tab}
        onChange={(value) => onSelectTab(value as MediaTab)}
        accessibilityLabel="Media, files and links"
        className="mb-2 mt-2"
      />
      {status === 'loading' ? <StateMessage kind="loading" title={MEDIA_LOADING_TEXT} /> : null}
      {status === 'error' ? (
        <StateMessage kind="error" title={error} action={{ label: 'Retry', onPress: onRetry }} />
      ) : null}
      {status === 'ready' && items.length === 0 ? (
        <StateMessage kind="empty" title={MEDIA_EMPTY_TEXT[tab]} />
      ) : null}
      {showRows && tab === 'media' ? <MediaGrid items={items} onShowInChat={onShowInChat} /> : null}
      {showRows && tab !== 'media' ? (
        <MediaRowList tab={tab} items={items} onShowInChat={onShowInChat} onOpenLink={onOpenLink} />
      ) : null}
      {status === 'ready' && error !== '' ? (
        <Text accessibilityRole="alert" className="py-1 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
      {status === 'ready' && next !== null ? (
        <Button
          variant="outline"
          className="mt-2"
          disabled={loadingMore}
          accessibilityLabel="Load more media"
          onPress={onLoadMore}
        >
          <Text>{loadingMore ? 'Loading…' : 'Load more'}</Text>
        </Button>
      ) : null}
    </View>
  );
}

export { MEDIA_EMPTY_TEXT, MEDIA_LOADING_TEXT };
export type { MediaSheetContentProps };
export type { MediaSheetStatus };

const MEDIA_MORE_ERROR_TEXT = 'Could not load more. Try again.';

export interface MediaSheetProps {
  chatId: string;
  title?: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}

interface SheetState {
  tab: MediaTab;
  status: MediaSheetStatus;
  items: MediaItem[];
  next: string | null;
  loadingMore: boolean;
  error: string;
}

const INITIAL_SHEET_STATE: SheetState = {
  tab: 'media',
  status: 'loading',
  items: [],
  next: null,
  loadingMore: false,
  error: '',
};

// The chat media sheet: Media/Files/Links/Voice tabs, one page loaded on open and per tab change, cursor paging, and a jump to a message (then close). The screen mounts it only while open.
export function MediaSheet({
  chatId,
  title = 'Media, files and links',
  onClose,
  onJump,
}: MediaSheetProps) {
  const loadChatMedia = useChatStore((state) => state.loadChatMedia);
  const [state, setState] = useState<SheetState>(INITIAL_SHEET_STATE);
  const [reloadTick, setReloadTick] = useState(0);
  // Guarded synchronously, so a double tap before React re-renders the disabled button cannot fire two page loads.
  const loadingMoreRef = useRef(false);
  const { tab } = state;

  useEffect(() => {
    // The cleanup interrupts the load, so an answer for an old tab or chat never replaces the current one.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => loadChatMedia(chatId, tab)).pipe(
        Effect.match({
          onSuccess: (page) => {
            setState((current) =>
              current.tab !== tab
                ? current
                : { ...current, status: 'ready', items: page.items, next: page.next, error: '' },
            );
          },
          onFailure: () => {
            setState((current) =>
              current.tab !== tab
                ? current
                : {
                    ...current,
                    status: 'error',
                    items: [],
                    next: null,
                    error: MEDIA_LOAD_ERROR_TEXT,
                  },
            );
          },
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [chatId, tab, reloadTick, loadChatMedia]);

  const selectTab = (newTab: MediaTab) => {
    if (newTab === state.tab) {
      return;
    }
    setState({
      tab: newTab,
      status: 'loading',
      items: [],
      next: null,
      loadingMore: false,
      error: '',
    });
  };

  const retry = () => {
    setState((current) => ({ ...current, status: 'loading', items: [], next: null, error: '' }));
    setReloadTick((tick) => tick + 1);
  };

  const loadMore = () => {
    if (state.next === null || state.loadingMore || loadingMoreRef.current) {
      return;
    }
    const cursor = state.next;
    const targetTab = state.tab;
    loadingMoreRef.current = true;
    setState((current) => ({ ...current, loadingMore: true, error: '' }));
    // Not tied to the sheet's lifetime: a page in flight still lands.
    Effect.runFork(
      Effect.tryPromise(() => loadChatMedia(chatId, targetTab, cursor)).pipe(
        Effect.match({
          onSuccess: (page) => {
            setState((current) =>
              current.tab !== targetTab
                ? current
                : {
                    ...current,
                    items: [...current.items, ...page.items],
                    next: page.next,
                    loadingMore: false,
                  },
            );
          },
          onFailure: () => {
            setState((current) =>
              current.tab !== targetTab
                ? current
                : { ...current, loadingMore: false, error: MEDIA_MORE_ERROR_TEXT },
            );
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            loadingMoreRef.current = false;
          }),
        ),
      ),
    );
  };

  const showInChat = (item: MediaItem) => {
    onJump(item.messageId);
    onClose();
  };

  const openLink = (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      return;
    }
    // A refused open (no handler) is silent, like the rest of the app.
    Effect.runFork(Effect.tryPromise(() => Linking.openURL(url)).pipe(Effect.ignore));
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      closeLabel="Close media, files and links"
      title={title}
      maxHeightClassName="max-h-[80%]"
    >
      <MediaSheetContent
        tab={state.tab}
        status={state.status}
        items={state.items}
        next={state.next}
        loadingMore={state.loadingMore}
        error={state.error}
        onSelectTab={selectTab}
        onShowInChat={showInChat}
        onOpenLink={openLink}
        onLoadMore={loadMore}
        onRetry={retry}
      />
    </BottomSheet>
  );
}

// Human file size, e.g. `512 B`, `2.0 KB`, `5.0 MB`; `chat-core` has no size helper.
function formatMediaSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))} MB`;
}

function rowKey(item: MediaItem): string {
  return `${item.messageId}:${item.linkUrl ?? item.kind}`;
}

function isRemoteImage(item: MediaItem): boolean {
  if (item.kind !== 'image' && item.kind !== 'gif') return false;
  const url = item.url?.toLowerCase();
  return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'));
}

function dateOf(item: MediaItem): string {
  return formatShortDate(new Date(item.at));
}

function metaLine(parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
}

function MediaGrid({
  items,
  onShowInChat,
}: {
  items: MediaItem[];
  onShowInChat: (item: MediaItem) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1 pt-2">
      {items.map((item, index) =>
        isRemoteImage(item) ? (
          <Pressable
            key={`${rowKey(item)}:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Show ${item.name ?? 'media'} in chat`}
            onPress={() => onShowInChat(item)}
            className="h-24 w-[31%] overflow-hidden rounded-md bg-surface-raised active:opacity-70"
          >
            <Image source={{ uri: item.url ?? '' }} resizeMode="cover" className="h-full w-full" />
          </Pressable>
        ) : (
          <FileRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />
        ),
      )}
    </View>
  );
}

function MediaRowList({
  tab,
  items,
  onShowInChat,
  onOpenLink,
}: {
  tab: MediaTab;
  items: MediaItem[];
  onShowInChat: (item: MediaItem) => void;
  onOpenLink: (url: string) => void;
}) {
  return (
    <View className="pt-1">
      {items.map((item, index) => {
        if (tab === 'links') {
          return (
            <LinkRow
              key={`${rowKey(item)}:${index}`}
              item={item}
              onShowInChat={onShowInChat}
              onOpenLink={onOpenLink}
            />
          );
        }
        if (tab === 'voice') {
          return (
            <VoiceRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />
          );
        }
        return <FileRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />;
      })}
    </View>
  );
}

// The shared chrome of the per-tab rows: the left body keeps each row's texts, and the trailing button is the same for every tab.
function MediaRow({
  item,
  label,
  onShowInChat,
  children,
}: {
  item: MediaItem;
  label: string;
  onShowInChat: (item: MediaItem) => void;
  children: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2 border-t border-divider py-2">
      {children}
      <ShowInChatButton item={item} label={label} onShowInChat={onShowInChat} />
    </View>
  );
}

function FileRow({
  item,
  onShowInChat,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
}) {
  const name = item.name ?? 'File';
  return (
    <MediaRow item={item} label={name} onShowInChat={onShowInChat}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[13px] text-foreground">
          {name}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {metaLine([
            item.size === undefined ? undefined : formatMediaSize(item.size),
            dateOf(item),
          ])}
        </Text>
      </View>
    </MediaRow>
  );
}

function LinkRow({
  item,
  onShowInChat,
  onOpenLink,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
  onOpenLink: (url: string) => void;
}) {
  const url = item.linkUrl ?? item.url ?? '';
  const host = item.linkHost ?? url;
  return (
    <MediaRow item={item} label={host} onShowInChat={onShowInChat}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${url}`}
        onPress={() => onOpenLink(url)}
        className="min-w-0 flex-1 active:opacity-70"
      >
        <Text numberOfLines={1} className="text-[13px] font-medium text-foreground">
          {host}
        </Text>
        <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
          {url}
        </Text>
      </Pressable>
    </MediaRow>
  );
}

function VoiceRow({
  item,
  onShowInChat,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
}) {
  const duration = item.durationMs === undefined ? undefined : formatDuration(item.durationMs);
  return (
    <MediaRow item={item} label="voice message" onShowInChat={onShowInChat}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[13px] text-foreground">
          {duration ?? 'Voice message'}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {metaLine([item.senderName, dateOf(item)])}
        </Text>
      </View>
    </MediaRow>
  );
}

function ShowInChatButton({
  item,
  label,
  onShowInChat,
}: {
  item: MediaItem;
  label: string;
  onShowInChat: (item: MediaItem) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      accessibilityLabel={`Show ${label} in chat`}
      onPress={() => onShowInChat(item)}
      className="shrink-0 rounded-full"
    >
      <Text className="text-[13px] font-medium text-accent">Show in chat</Text>
    </Button>
  );
}
