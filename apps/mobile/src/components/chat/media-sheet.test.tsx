// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `react-dom/client` ships no bundled types and mobile has no `@types/react-dom`,
// so load it through a typed require handle rather than an untyped import.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

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

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('../ui/text', () => ({ Text: 'Text' }));
vi.mock('../ui/button', () => ({ Button: 'Button' }));
vi.mock('../ui/bottom-sheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../ui/segmented-control', () => ({ SegmentedControl: 'SegmentedControl' }));
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

  it('draws an Image tile for a remote https image', () => {
    const html = render({
      tab: 'media',
      items: [
        {
          messageId: 'm-1',
          chat: 'ana',
          at: '2026-09-30T11:00:00Z',
          senderName: 'Ana',
          kind: 'image',
          url: 'https://files.zilar.test/a.jpg',
          name: 'a.jpg',
        },
      ],
    });
    expect(html).toContain('Image');
    expect(html).toContain('Show a.jpg in chat');
  });

  it('renders a gradient url and a file item without an Image tile', () => {
    const html = render({
      tab: 'media',
      items: [
        {
          messageId: 'm-1',
          chat: 'ana',
          at: '2026-09-30T11:00:00Z',
          senderName: 'Ana',
          kind: 'image',
          url: 'gradient:sunrise',
        },
        {
          messageId: 'm-2',
          chat: 'ana',
          at: '2026-09-30T11:00:00Z',
          senderName: 'Ana',
          kind: 'file',
          url: 'https://files.zilar.test/report.pdf',
          name: 'report.pdf',
        },
      ],
    });
    expect(html).not.toContain('Image');
    expect(html).toContain('report.pdf');
  });

  it('renders two identical rows without a duplicate-key warning', async () => {
    // The duplicate-key warning only fires in the client reconciler, so this
    // renders through `react-dom/client` (jsdom) instead of static markup.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = {
      messageId: 'm-1',
      chat: 'ana',
      at: '2026-09-30T11:00:00Z',
      senderName: 'Ana',
      kind: 'link' as const,
      linkUrl: 'https://example.test/a',
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(MediaSheetContent, { ...BASE, tab: 'links', items: [item, { ...item }] }),
      );
    });
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('same key');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    errorSpy.mockRestore();
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
