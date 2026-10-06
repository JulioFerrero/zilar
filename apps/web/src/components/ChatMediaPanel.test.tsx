import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import type { MediaItem, MediaPage, MediaTab } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed, type ChatStoreState } from '@/store/store';
import { ChatMediaPanel } from './ChatMediaPanel';

const auth = {
  status: 'authenticated' as const,
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function message(overrides: Partial<UiMessage> & { id: string }): UiMessage {
  return {
    chatId: 'c-ana',
    senderId: 'u-ana',
    senderName: 'Ana',
    createdAt: new Date('2026-10-05T10:00:00Z'),
    status: 'read',
    ...overrides,
  };
}

const imageMessage = message({
  id: 'm-img',
  attachment: {
    kind: 'image',
    url: 'https://upload.zilar.test/stage.png',
    name: 'stage.png',
    size: 245_760,
    mime: 'image/png',
    width: 640,
    height: 420,
  },
});

const fileMessage = message({
  id: 'm-file',
  attachment: {
    kind: 'file',
    url: 'https://upload.zilar.test/tickets.pdf',
    name: 'tickets.pdf',
    size: 2_411_724,
    mime: 'application/pdf',
  },
});

const linkMessage = message({ id: 'm-link', text: 'see https://example.com/docs now' });

const voiceMessage = message({
  id: 'm-voice',
  voice: { duration_ms: 65_000, mime: 'audio/mp4', waveform: [1, 2, 3] },
});

const emptyPage: MediaPage = { items: [], next: null };

function mediaItem(overrides: Partial<MediaItem> & { messageId: string }): MediaItem {
  return {
    chat: 'c-ana',
    at: '2026-10-05T10:00:00.000Z',
    senderName: 'Ana',
    kind: 'image',
    ...overrides,
  };
}

function renderPanel(seed: ChatStoreSeed = {}, overrides: Partial<ChatStoreState> = {}) {
  const store = createChatStore({ chats: [chat], ...seed });
  store.setState(overrides);
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <ChatMediaPanel chatId={chat.id} onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

afterEach(() => {
  cleanup();
});

describe('ChatMediaPanel (T-0434)', () => {
  it('renders the media grid with lazy images and switches tabs', async () => {
    renderPanel({
      messagesByChat: {
        'c-ana': [imageMessage, fileMessage, linkMessage, voiceMessage],
      },
    });

    const image = await screen.findByRole('img', { name: 'stage.png' });
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('src')).toBe('https://upload.zilar.test/stage.png');

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('tickets.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    const link = await screen.findByRole('link', { name: 'example.com' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    fireEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    expect(await screen.findByText('1:05')).toBeTruthy();
  });

  it('shows a file row and no <img> for an item without a url', async () => {
    const page: MediaPage = {
      items: [mediaItem({ messageId: 'm-1', name: 'stage.png' })],
      next: null,
    };
    renderPanel({ messagesByChat: { 'c-ana': [] } }, { loadChatMedia: vi.fn(async () => page) });

    expect(await screen.findByText('stage.png')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a per-tab empty message', async () => {
    renderPanel({ messagesByChat: { 'c-ana': [] } });

    expect(await screen.findByText('No media yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('No files yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(await screen.findByText('No links yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    expect(await screen.findByText('No voice messages yet')).toBeTruthy();
  });

  it('shows the error state and retries', async () => {
    const load = vi
      .fn<(chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>>()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue(emptyPage);
    renderPanel({ messagesByChat: { 'c-ana': [] } }, { loadChatMedia: load });

    expect(await screen.findByText('Could not load media')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No media yet')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('appends the next page with Load more', async () => {
    const first: MediaPage = {
      items: [
        mediaItem({
          messageId: 'm-a',
          name: 'a.png',
          url: 'https://upload.zilar.test/a.png',
        }),
      ],
      next: '100',
    };
    const second: MediaPage = {
      items: [
        mediaItem({
          messageId: 'm-b',
          name: 'b.png',
          url: 'https://upload.zilar.test/b.png',
        }),
      ],
      next: null,
    };
    const load = vi
      .fn<(chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    renderPanel({ messagesByChat: { 'c-ana': [] } }, { loadChatMedia: load });

    expect(await screen.findByRole('img', { name: 'a.png' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('img', { name: 'b.png' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'a.png' })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('jumps to the message and closes on Show in chat', async () => {
    const openAtMessage = vi.fn(async () => imageMessage);
    const { onClose } = renderPanel(
      { messagesByChat: { 'c-ana': [imageMessage] } },
      { openAtMessage },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Show stage.png in chat' }));

    await waitFor(() => {
      expect(openAtMessage).toHaveBeenCalledWith('c-ana', 'm-img');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders both rows when one message has two links', async () => {
    const twoLinks = message({
      id: 'm-two',
      text: 'first https://one.example.com/a then https://two.example.com/b',
    });
    renderPanel({ messagesByChat: { 'c-ana': [twoLinks] } });

    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));

    expect(await screen.findByRole('link', { name: 'one.example.com' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'two.example.com' })).toBeTruthy();
  });
});
