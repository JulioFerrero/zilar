import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import * as api from '@/lib/api';
import { renderApp } from '@/test/renderApp';

const demoPack = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  ownerId: 'u-you',
  title: 'Cats',
  visibility: 'server' as const,
  stickers: [
    {
      id: '223e4567-e89b-12d3-a456-426614174001',
      packId: '123e4567-e89b-12d3-a456-426614174000',
      emoji: '🐱',
      mime: 'image/webp' as const,
      width: 200,
      height: 200,
      bytes: 1024,
      url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
    },
    {
      id: '323e4567-e89b-12d3-a456-426614174002',
      packId: '123e4567-e89b-12d3-a456-426614174000',
      emoji: '😹',
      mime: 'image/png' as const,
      width: 200,
      height: 200,
      bytes: 2048,
      url: '/api/stickers/323e4567-e89b-12d3-a456-426614174002/file',
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(api, 'listStickerPacks').mockResolvedValue([demoPack]);
  vi.spyOn(api, 'discoverStickerPacks').mockResolvedValue({ packs: [], next: null });
});

describe('StickerPanel', () => {
  it('opens from the smiley button with Stickers / GIFs / Emoji tabs', async () => {
    renderApp('/c/c-ana');

    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    expect(screen.getByRole('dialog', { name: 'Stickers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Stickers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'GIFs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Emoji' })).toBeTruthy();

    expect(await screen.findByRole('tab', { name: 'Recent' })).toBeTruthy();
  });

  it('shows "Coming soon" on the GIFs tab until T-0122', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));

    fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });

  it('shows a grid of common emoji on the Emoji tab', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));

    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));
    const grid = screen.getByRole('grid', { name: 'Emoji' });
    expect(within(grid).getByLabelText('Insert 😀')).toBeTruthy();
  });

  it('lists pack tabs and sends a sticker on click', async () => {
    const { store } = renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Cats' }));
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    const before = store.getState().messages('c-ana').length;
    fireEvent.click(within(grid).getByLabelText('🐱'));

    const after = store.getState().messages('c-ana');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.card).toEqual({
      v: 0,
      type: 'sticker',
      data: {
        pack_id: '123e4567-e89b-12d3-a456-426614174000',
        sticker_id: '223e4567-e89b-12d3-a456-426614174001',
        url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
        emoji: '🐱',
        width: 200,
        height: 200,
        mime: 'image/webp',
      },
    });
    // The dialog closes and the sticker lands in recents.
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull();
    expect(window.localStorage.getItem('galena:recentStickers')).toContain(
      '223e4567-e89b-12d3-a456-426614174001',
    );
  });

  it('refuses a tampered recents entry with a visible error and no bubble', async () => {
    window.localStorage.setItem(
      'galena:recentStickers',
      JSON.stringify([
        { stickerId: 'not-a-uuid', packId: 'also-not-a-uuid', url: '/api/stickers/x/file' },
      ]),
    );
    const { store } = renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    const before = store.getState().messages('c-ana').length;

    fireEvent.click(within(grid).getAllByRole('button')[0]!);

    expect(store.getState().messages('c-ana')).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: 'c-ana',
      message: 'That sticker could not be sent.',
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps hostile localStorage recents from breaking the panel', async () => {
    window.localStorage.setItem('galena:recentStickers', '[{"nope":true},42]');
    renderApp('/c/c-ana');

    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    expect(await screen.findByRole('dialog', { name: 'Stickers' })).toBeTruthy();
  });

  it('never fetches a hostile URL planted in recents', async () => {
    window.localStorage.setItem(
      'galena:recentStickers',
      JSON.stringify([
        {
          stickerId: 'st-evil',
          packId: 'pack-evil',
          url: 'https://evil.example.com/track.png',
          emoji: '😈',
        },
      ]),
    );
    renderApp('/c/c-ana');

    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    // An emoji tile shows instead of an <img>, so nothing is fetched.
    expect(grid.querySelector('img')).toBeNull();
    const images = document.querySelectorAll('img');
    for (const img of images) {
      expect(img.getAttribute('src')).not.toContain('evil.example.com');
    }
  });
});

describe('StickerMessage', () => {
  it('renders a sticker without a bubble and the same-origin image', () => {
    renderApp('/c/c-ana', {
      messagesByChat: {
        'c-ana': [
          {
            id: 'm-st',
            chatId: 'c-ana',
            senderId: 'u-ana',
            senderName: 'Ana',
            text: '🐱',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
            card: {
              v: 0,
              type: 'sticker',
              data: {
                pack_id: 'pack-1',
                sticker_id: 'st-1',
                url: '/api/stickers/st-1/file',
                emoji: '🐱',
                width: 200,
                height: 200,
                mime: 'image/webp',
              },
            },
          },
        ],
      },
    });

    const image = screen.getByAltText('🐱');
    expect(image.getAttribute('src')).toBe('/api/stickers/st-1/file');
    expect(image.getAttribute('loading')).toBe('lazy');
    // No bubble around the sticker.
    expect(image.closest('[data-bubble-look]')).toBeNull();
  });

  it('shows a placeholder for a hostile cross-origin sticker URL', () => {
    renderApp('/c/c-ana', {
      messagesByChat: {
        'c-ana': [
          {
            id: 'm-evil',
            chatId: 'c-ana',
            senderId: 'u-ana',
            senderName: 'Ana',
            text: '',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
            card: {
              v: 0,
              type: 'sticker',
              data: {
                pack_id: 'pack-1',
                sticker_id: 'st-evil',
                url: 'https://evil.example.com/track.png',
                width: 200,
                height: 200,
                mime: 'image/png',
              },
            },
          },
        ],
      },
    });

    // A placeholder with the fallback label, and no fetch of the hostile URL.
    expect(screen.getByLabelText('Sticker')).toBeTruthy();
    expect(screen.queryByAltText('Sticker')).toBeNull();
    const images = document.querySelectorAll('img');
    for (const img of images) {
      expect(img.getAttribute('src')).not.toContain('evil.example.com');
    }
  });

  it('supports reply quotes and reactions on a sticker', () => {
    const { store } = renderApp('/c/c-ana', {
      currentUserId: 'u-you',
      messagesByChat: {
        'c-ana': [
          {
            id: 'm-st',
            chatId: 'c-ana',
            senderId: 'u-ana',
            senderName: 'Ana',
            text: '🐱',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
            replyTo: { id: 'm-1', senderName: 'You', text: 'hi' },
            reactions: [{ emoji: '❤️', count: 1, mine: false, reactors: ['You'] }],
            card: {
              v: 0,
              type: 'sticker',
              data: {
                pack_id: 'pack-1',
                sticker_id: 'st-1',
                url: '/api/stickers/st-1/file',
                emoji: '🐱',
                width: 200,
                height: 200,
                mime: 'image/webp',
              },
            },
          },
        ],
      },
    });
    expect(screen.getByAltText('🐱')).toBeTruthy();
    expect(screen.getByText('❤️')).toBeTruthy();
    expect(store.getState().messages('c-ana')[0]?.replyTo?.id).toBe('m-1');
  });

  it('opens the actions menu on a sticker (react, reply, pin, delete)', () => {
    renderApp('/c/c-ana', {
      currentUserId: 'u-you',
      messagesByChat: {
        'c-ana': [
          {
            id: 'm-st',
            chatId: 'c-ana',
            senderId: 'u-you',
            senderName: 'You',
            text: '🐱',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
            card: {
              v: 0,
              type: 'sticker',
              data: {
                pack_id: 'pack-1',
                sticker_id: 'st-1',
                url: '/api/stickers/st-1/file',
                emoji: '🐱',
                width: 200,
                height: 200,
                mime: 'image/webp',
              },
            },
          },
        ],
      },
    });

    fireEvent.click(screen.getByLabelText('Message actions'));
    const menu = screen.getByRole('menu', { name: 'Message actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Delete for everyone' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Pin' })).toBeTruthy();
    // Stickers carry no editable text: Edit is hidden, Copy text is disabled.
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(
      within(menu).getByRole('menuitem', { name: 'Copy text' }).getAttribute('disabled'),
    ).not.toBeNull();
  });

  it('shows a Retry on a failed sticker and resends on click', () => {
    const { store } = renderApp('/c/c-ana', {
      currentUserId: 'u-you',
      messagesByChat: {
        'c-ana': [
          {
            id: 'm-failed',
            chatId: 'c-ana',
            senderId: 'u-you',
            senderName: 'You',
            text: '🐱',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'sending',
            failed: true,
            card: {
              v: 0,
              type: 'sticker',
              data: {
                pack_id: 'pack-1',
                sticker_id: 'st-1',
                url: '/api/stickers/st-1/file',
                emoji: '🐱',
                width: 200,
                height: 200,
                mime: 'image/webp',
              },
            },
          },
        ],
      },
    });

    fireEvent.click(screen.getByLabelText('Retry sticker'));
    expect(store.getState().messages('c-ana')[0]?.failed).toBeUndefined();
  });
});
