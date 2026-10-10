import { Effect, Fiber } from 'effect';
import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { BottomSheet } from '../ui/bottom-sheet';
import {
  MEDIA_LOAD_ERROR_TEXT,
  MediaSheetContent,
  type MediaSheetStatus,
} from './media-sheet-content';
import { formatMediaSize } from './media-rows';
import type { MediaItem, MediaTab } from '../../lib/media-api';
import { useChatStore } from '../../store/chat-store-provider';

export { formatDuration } from '@zilar/chat-core';
export { MEDIA_EMPTY_TEXT, MEDIA_LOADING_TEXT } from './media-sheet-content';
export type { MediaSheetContentProps } from './media-sheet-content';
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

/**
 * The chat media sheet (T-0436): the Media/Files/Links/Voice tabs reachable
 * from the header button. It loads one page when it opens and whenever the
 * tab changes, pages with the cursor, and jumps to a message (then closes).
 * The screen mounts it only while it is open.
 */
export function MediaSheet({
  chatId,
  title = 'Media, files and links',
  onClose,
  onJump,
}: MediaSheetProps) {
  const loadChatMedia = useChatStore((state) => state.loadChatMedia);
  const [state, setState] = useState<SheetState>(INITIAL_SHEET_STATE);
  const [reloadTick, setReloadTick] = useState(0);
  // Guarded synchronously so a double tap landing before React re-renders
  // the disabled button can never fire two page loads (like `AiActivity`).
  const loadingMoreRef = useRef(false);
  const { tab } = state;

  useEffect(() => {
    // The cleanup interrupts the load, so an answer for an old tab or chat
    // never replaces the current one.
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
    // Not tied to the sheet's lifetime: a page in flight still lands, as before.
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
