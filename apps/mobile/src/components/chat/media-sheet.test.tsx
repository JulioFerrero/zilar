import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  formatDuration,
  formatMediaSize,
  MEDIA_EMPTY_TEXT,
  MEDIA_LOADING_TEXT,
  MediaSheetContent,
  type MediaSheetContentProps,
} from './media-sheet';

vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  Image: 'Image',
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn() },
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('../ui/text', () => ({ Text: 'Text' }));
vi.mock('../ui/button', () => ({ Button: 'Button' }));
vi.mock('../ui/bottom-sheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../../store/chat-store-provider', () => ({ useChatStore: () => undefined }));

const BASE: MediaSheetContentProps = {
  tab: 'media',
  status: 'ready',
  items: [],
  next: null,
  loadingMore: false,
  error: '',
  onSelectTab: () => {},
  onShowInChat: () => {},
  onOpenLink: () => {},
  onLoadMore: () => {},
  onRetry: () => {},
};

function render(overrides: Partial<MediaSheetContentProps> = {}): string {
  return renderToStaticMarkup(createElement(MediaSheetContent, { ...BASE, ...overrides }));
}

describe('MediaSheetContent', () => {
  it('shows the per-tab empty sentence', () => {
    expect(render({ tab: 'media' })).toContain(MEDIA_EMPTY_TEXT.media);
    expect(render({ tab: 'files' })).toContain(MEDIA_EMPTY_TEXT.files);
    expect(render({ tab: 'links' })).toContain(MEDIA_EMPTY_TEXT.links);
    expect(render({ tab: 'voice' })).toContain(MEDIA_EMPTY_TEXT.voice);
  });

  it('shows the loading state until the page arrives', () => {
    expect(render({ status: 'loading' })).toContain(MEDIA_LOADING_TEXT);
  });

  it('lists a file row with its name and size', () => {
    const html = render({
      tab: 'files',
      items: [
        {
          messageId: 'm-1',
          chat: 'ana',
          at: '2026-09-30T11:00:00Z',
          senderName: 'Ana',
          kind: 'file',
          name: 'report.pdf',
          size: 2048,
        },
      ],
    });
    expect(html).toContain('report.pdf');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('Show report.pdf in chat');
  });

  it('shows Load more only while a next cursor exists', () => {
    expect(render({ next: 'cursor' })).toContain('Load more');
    expect(render({ next: null })).not.toContain('Load more');
  });
});

describe('media helpers', () => {
  it('formats file sizes', () => {
    expect(formatMediaSize(0)).toBe('0 B');
    expect(formatMediaSize(512)).toBe('512 B');
    expect(formatMediaSize(2048)).toBe('2.0 KB');
    expect(formatMediaSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('reuses the chat-core duration formatter', () => {
    expect(formatDuration(12_400)).toBe('0:12');
    expect(formatDuration(65_000)).toBe('1:05');
  });
});
