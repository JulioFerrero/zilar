import { View } from 'react-native';

import { Button } from '../ui/button';
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control';
import { StateMessage } from '../ui/state-message';
import { Text } from '../ui/text';
import type { MediaItem, MediaTab } from '../../lib/media-api';
import { MediaGrid, MediaRowList } from './media-rows';

/** The gallery tab labels, in the order the segmented control shows them. */
const TAB_OPTIONS: SegmentedOption[] = [
  { value: 'media', label: 'Media' },
  { value: 'files', label: 'Files' },
  { value: 'links', label: 'Links' },
  { value: 'voice', label: 'Voice' },
];

/** The empty sentence per tab, shown once a finished load has no rows. */
export const MEDIA_EMPTY_TEXT: Record<MediaTab, string> = {
  media: 'No media yet',
  files: 'No files yet',
  links: 'No links yet',
  voice: 'No voice messages yet',
};

export const MEDIA_LOADING_TEXT = 'Loading media…';
export const MEDIA_LOAD_ERROR_TEXT = 'Could not load media. Try again.';

export type MediaSheetStatus = 'loading' | 'error' | 'ready';

export interface MediaSheetContentProps {
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

/**
 * The gallery's pure view (T-0436): the tabs, the grid or per-tab rows, the
 * empty/loading/error states and the Load more button. The connected
 * `MediaSheet` owns the load; this stays hook-free so tests can render it
 * directly.
 */
export function MediaSheetContent({
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
