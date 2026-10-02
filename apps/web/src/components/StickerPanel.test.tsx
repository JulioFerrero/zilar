import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as api from '@/lib/api';
import { resetGifsAvailability, probeGifsAvailability } from '@/components/GifPanel';
import { StickerPanel } from '@/components/StickerPanel';
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
  vi.spyOn(api, 'listStickerFavorites').mockResolvedValue([]);
  resetGifsAvailability();
});

afterEach(() => {
  resetGifsAvailability();
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

  it('shows the GIFs tab content instead of "Coming soon" (T-0122)', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));

    fireEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByLabelText('Search GIFs')).toBeTruthy();
    expect(await screen.findByRole('grid', { name: 'GIFs' })).toBeTruthy();
  });

  it('hides the GIFs tab when the provider is off (T-0146)', () => {
    // The forced `hide` stands in for the 501 probe answer (the real probe
    // is unit-tested in `GifPanel.test.tsx`): the tab disappears instead of
    // showing a dead-end message, while Stickers and Emoji stay.
    const { unmount } = render(
      <StickerPanel
        onPick={() => {}}
        onClose={() => {}}
        onEmoji={() => {}}
        onGifPick={() => {}}
        gifsTab="hide"
      />,
    );
    expect(screen.queryByRole('tab', { name: 'GIFs' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Stickers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Emoji' })).toBeTruthy();
    unmount();
    // The forced `show` keeps the tab (the default in tests and mock mode).
    render(
      <StickerPanel
        onPick={() => {}}
        onClose={() => {}}
        onEmoji={() => {}}
        onGifPick={() => {}}
        gifsTab="show"
      />,
    );
    expect(screen.getByRole('tab', { name: 'GIFs' })).toBeTruthy();
  });

  it('remembers one probe per session (T-0146)', async () => {
    // The panel probes once per session and remembers the answer: these
    // calls go through the same cache the panel reads. A 501 answers
    // `false` once; a second call reuses the cached answer with no second
    // request.
    resetGifsAvailability();
    try {
      const trending = vi.spyOn(api, 'trendingGifs');
      trending.mockRejectedValueOnce(new api.ApiError(501, 'gifs_unavailable', 'off'));
      await expect(probeGifsAvailability()).resolves.toBe(false);
      trending.mockResolvedValueOnce({ items: [], nextPos: undefined });
      await expect(probeGifsAvailability()).resolves.toBe(false);
      expect(trending).toHaveBeenCalledTimes(1);
    } finally {
      resetGifsAvailability();
    }
  });

  it('shows a grid of common emoji on the Emoji tab', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));

    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));
    const grid = screen.getByRole('grid', { name: 'Emoji' });
    expect(within(grid).getByLabelText('Insert 😀')).toBeTruthy();
  });

  it('closes the sticker panel on an outside pointer-down', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    expect(await screen.findByRole('dialog', { name: 'Stickers' })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull();
  });

  it('toggles the panel closed with the button (not the outside path)', async () => {
    // The toggle itself is inside the outside-click wrapper: pressing it
    // toggles (open -> close via the button), never via the outside path.
    renderApp('/c/c-ana');
    const toggle = screen.getByLabelText('Open sticker panel');
    fireEvent.click(toggle);
    expect(await screen.findByRole('dialog', { name: 'Stickers' })).toBeTruthy();

    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull();
  });

  it('renders a 5-column grid of 56 px tiles that fit the 344 px panel', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Cats' }));
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    // 5 columns x 56 px + 4 gaps x 8 px + 2 padding x 8 px = 328 px, inside
    // the min-344 px panel: tiles can never overlap.
    expect(grid.className).toContain('grid-cols-5');
    const tiles = dialog.querySelectorAll('[data-testid="sticker-grid"] > span');
    expect(tiles.length).toBe(2);
    for (const tile of tiles) {
      expect(tile.className).toContain('size-[56px]');
    }
  });

  it('anchors the panel to the viewport bottom-right (above the emoji button)', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    // Fixed to the viewport's bottom-right above the emoji button and
    // clamped to the viewport on narrow windows — never the old far-left
    // `left-0` of the message column.
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('right-4');
    expect(dialog.className).not.toContain('left-0');
    expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]');
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
    expect(window.localStorage.getItem('zilar:recentStickers')).toContain(
      '223e4567-e89b-12d3-a456-426614174001',
    );
  });

  it('sends a demo sticker in mock mode (relative URL passes validation)', async () => {
    // T-0141: mock/demo panel stickers must be sendable — the old `data:`
    // URLs failed `StickerSchema` at send time ("That sticker could not be
    // sent"). The mock store validates like the real one, so a bubble plus
    // no action error proves the demo URL shape sends.
    const { mockDemoStickerPacks } = await import('@/mock/helpers');
    const packs = mockDemoStickerPacks();
    const pack = packs[0]!;
    const sticker = pack.stickers[0]!;
    vi.spyOn(api, 'listStickerPacks').mockResolvedValue([
      {
        id: pack.id,
        ownerId: 'u-you',
        title: pack.title,
        visibility: 'server',
        stickers: pack.stickers.map((item) => ({
          id: item.id,
          packId: pack.id,
          emoji: item.emoji,
          mime: 'image/png' as const,
          width: 200,
          height: 200,
          bytes: 1024,
          url: item.url,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const { store } = renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });
    fireEvent.click(within(dialog).getByRole('tab', { name: pack.title }));
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    const before = store.getState().messages('c-ana').length;
    fireEvent.click(within(grid).getByLabelText(sticker.emoji));

    const after = store.getState().messages('c-ana');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.card).toMatchObject({
      v: 0,
      type: 'sticker',
      data: { sticker_id: sticker.id, url: sticker.url },
    });
    expect(store.getState().actionError).toBeUndefined();
  });

  it('refuses a tampered recents entry with a visible error and no bubble', async () => {
    window.localStorage.setItem(
      'zilar:recentStickers',
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
    window.localStorage.setItem('zilar:recentStickers', '[{"nope":true},42]');
    renderApp('/c/c-ana');

    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    expect(await screen.findByRole('dialog', { name: 'Stickers' })).toBeTruthy();
  });

  it('never fetches a hostile URL planted in recents', async () => {
    window.localStorage.setItem(
      'zilar:recentStickers',
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

describe('StickerPanel favorites (T-0121)', () => {
  it('stars a sticker and shows it on the Favorites tab', async () => {
    const addFavorite = vi
      .spyOn(api, 'addStickerFavorite')
      .mockResolvedValue(demoPack.stickers[0]!);
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Cats' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Favorite 🐱' }));
    expect(addFavorite).toHaveBeenCalledWith('223e4567-e89b-12d3-a456-426614174001');

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Favorites' }));
    const grid = within(dialog).getByRole('grid', { name: 'Stickers' });
    expect(within(grid).getByLabelText('🐱')).toBeTruthy();
  });

  it('unfavorites from the Favorites tab', async () => {
    vi.mocked(api.listStickerFavorites).mockResolvedValue([demoPack.stickers[0]!]);
    const removeFavorite = vi.spyOn(api, 'removeStickerFavorite').mockResolvedValue(undefined);
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Favorites' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unfavorite 🐱' }));
    expect(removeFavorite).toHaveBeenCalledWith('223e4567-e89b-12d3-a456-426614174001');
  });

  it('shows the empty favorites text when nothing is starred', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Favorites' }));
    expect(
      within(dialog).getByText('No favorites yet. Star a sticker to keep it here.'),
    ).toBeTruthy();
  });

  it('shows the "+" tab and the Manage stickers link', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });
    expect(within(dialog).getByRole('tab', { name: 'Create sticker pack' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Manage stickers' })).toBeTruthy();
  });

  it('navigates to Settings → Stickers from the Manage link', async () => {
    renderApp('/c/c-ana');
    fireEvent.click(screen.getByLabelText('Open sticker panel'));
    const dialog = await screen.findByRole('dialog', { name: 'Stickers' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage stickers' }));
    expect(await screen.findByRole('heading', { name: 'Stickers' })).toBeTruthy();
  });
});
