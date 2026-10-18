import { Effect, Fiber } from 'effect';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { BottomSheet } from '../ui/bottom-sheet';
import { formatMediaSize, MediaGrid, MediaRowList } from './media-rows';
import type { MediaItem, MediaTab } from '../../lib/media-api';
import { useChatStore } from '../../store/chat-store-provider';
import { Button } from '../ui/button';
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control';
import { StateMessage } from '../ui/state-message';
import { Text } from '../ui/text';

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

export { formatDuration } from '@zilar/chat-core';
export { MEDIA_EMPTY_TEXT, MEDIA_LOADING_TEXT };
export type { MediaSheetContentProps };
export { formatMediaSize, MediaSheetContent, MEDIA_LOAD_ERROR_TEXT };
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
