import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { StickersPage } from './StickersPage';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const demoPack = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  ownerId: 'u-you',
  title: 'Cats',
  visibility: 'server',
  stickers: [
    {
      id: '223e4567-e89b-12d3-a456-426614174001',
      packId: '123e4567-e89b-12d3-a456-426614174000',
      emoji: '🐱',
      mime: 'image/webp',
      width: 200,
      height: 200,
      bytes: 1024,
      url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const addedPack = {
  ...demoPack,
  id: '323e4567-e89b-12d3-a456-426614174002',
  ownerId: 'u-ana',
  title: 'Dogs',
};

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
        refetch: async () => {},
      }}
    >
      <MemoryRouter initialEntries={['/settings/stickers']}>
        <Routes>
          <Route path="/settings/stickers" element={<StickersPage />} />
          <Route path="/" element={<div>Chat list</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StickersPage', () => {
  it('lists my packs, added packs and favorites', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [demoPack.stickers[0]] });
      }
      return jsonResponse(200, { packs: [demoPack, addedPack] });
    });
    renderPage(fetchMock);

    expect(await screen.findByText('Cats')).toBeTruthy();
    expect(screen.getByText('Dogs')).toBeTruthy();
    const favorites = screen.getByRole('list', { name: 'Favorite stickers' });
    expect(within(favorites).getByAltText('🐱')).toBeTruthy();
  });

  it('renders the page as a centered column with thumbnails in every pack row', async () => {
    const discoverPack = {
      ...addedPack,
      id: '523e4567-e89b-12d3-a456-426614174004',
      stickers: [demoPack.stickers[0]],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [discoverPack], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      return jsonResponse(200, { packs: [demoPack, addedPack] });
    });
    const { container } = renderPage(fetchMock);

    await screen.findByText('Cats');
    // A centered column with a sensible max width, like the other settings
    // pages: everything sits inside one shared `mx-auto max-w-2xl` column,
    // under the shell's title and description.
    expect(screen.getByRole('heading', { name: 'Stickers' })).toBeTruthy();
    expect(
      screen.getByText('Make packs from your images, share them, and star favorites.'),
    ).toBeTruthy();
    const column = container.querySelector('.mx-auto.max-w-2xl');
    expect(column).not.toBeNull();
    // Every pack row (mine, added, discover) shows a thumbnail strip. The
    // initial discover load already ran on mount, so the section shows the
    // pack without needing a search submit.
    for (const section of ['My packs', 'Packs I added', 'Discover']) {
      const region = screen.getByRole('region', { name: section });
      const images = within(region).getAllByRole('img');
      expect(images.length).toBeGreaterThan(0);
    }
    // The visibility badge and the sticker count are readable at a glance.
    const myPacks = screen.getByRole('region', { name: 'My packs' });
    expect(within(myPacks).getByText('Shared')).toBeTruthy();
    expect(within(myPacks).getByText(/1 sticker/)).toBeTruthy();
  });

  it('shows the error state with a retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: { code: 'boom', message: 'boom' } }));
    renderPage(fetchMock);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('searches discover and adds a pack', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [addedPack], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      return jsonResponse(200, { packs: [demoPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(calls.some((call) => call.startsWith('PUT /api/sticker-panel/'))).toBe(true);
    });
  });

  it('deletes a pack with the confirmation naming already-sent stickers', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url.endsWith('/sticker-packs')) {
        return jsonResponse(200, { packs: [demoPack] });
      }
      return jsonResponse(200, { warning: 'gone' });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    const myPacks = screen.getByRole('region', { name: 'My packs' });
    fireEvent.click(within(myPacks).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stickers already sent may stop loading.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => {
          const [url, init] = call as unknown as [string, RequestInit?];
          return url.includes(`/sticker-packs/${demoPack.id}`) && init?.method === 'DELETE';
        }),
      ).toBe(true);
    });
  });

  it('removes an own pack from the panel without deleting it', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url.includes('/sticker-panel/')) {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, { packs: [demoPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    const myPacks = screen.getByRole('region', { name: 'My packs' });
    fireEvent.click(within(myPacks).getByRole('button', { name: 'Remove from panel' }));
    await waitFor(() => {
      expect(calls.some((call) => call === `DELETE /api/sticker-panel/${demoPack.id}`)).toBe(true);
    });
  });

  it('reorders panel packs with Up/Down buttons through the atomic endpoint', async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.body !== undefined) {
        bodies.push(JSON.parse(init.body as string));
      }
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url.includes('/sticker-panel')) {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, { packs: [demoPack, addedPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    const myPacks = screen.getByRole('region', { name: 'My packs' });
    fireEvent.click(within(myPacks).getByRole('button', { name: 'Move Cats down' }));
    await waitFor(() => {
      expect(calls).toContain('PUT /api/sticker-panel');
    });
    // One atomic call with the full new order: Dogs before Cats.
    expect(bodies).toEqual([{ order: [addedPack.id, demoPack.id] }]);
  });

  it('restores the order and reports when the reorder fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url === '/api/sticker-panel') {
        return jsonResponse(400, { error: { code: 'invalid_request', message: 'stale order' } });
      }
      return jsonResponse(200, { packs: [demoPack, addedPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    const myPacks = screen.getByRole('region', { name: 'My packs' });
    fireEvent.click(within(myPacks).getByRole('button', { name: 'Move Cats down' }));
    // The server order is untouched (atomic), so the UI restores the old
    // order and says what happened.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('stale order');
    const names = within(myPacks)
      .getAllByText(/Cats|Dogs/)
      .map((node) => node.textContent);
    expect(names[0]).toBe('Cats');
  });

  it('opens the Telegram import from My packs and shows the result', async () => {
    const importedPack = {
      ...demoPack,
      id: '423e4567-e89b-12d3-a456-426614174003',
      title: 'Fun Cats',
      visibility: 'private',
      importedFrom: 'telegram:FunCats',
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url.endsWith('/sticker-packs/import/telegram')) {
        return jsonResponse(200, {
          pack: importedPack,
          imported: 5,
          skippedAnimated: 3,
          skippedInvalid: 0,
        });
      }
      return jsonResponse(200, { packs: [demoPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    fireEvent.click(screen.getByRole('button', { name: 'Import from Telegram' }));
    fireEvent.change(screen.getByLabelText('Pack link or name'), {
      target: { value: 'https://t.me/addstickers/FunCats' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported from Telegram: Fun Cats')).toBeTruthy();
  });

  it('hides the import entry when the server answers 501', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      if (typeof url === 'string' && url.endsWith('/sticker-packs/import/telegram')) {
        return jsonResponse(501, {
          error: { code: 'import_unavailable', message: 'Telegram import is not configured' },
        });
      }
      return jsonResponse(200, { packs: [demoPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Cats');
    fireEvent.click(screen.getByRole('button', { name: 'Import from Telegram' }));
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Import from Telegram' })).toBeNull();
    });
  });

  it('marks imported packs and locks them to private', async () => {
    const importedPack = {
      ...demoPack,
      title: 'Fun Cats',
      visibility: 'private',
      importedFrom: 'telegram:FunCats',
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (typeof url === 'string' && url.includes('/sticker-packs/discover')) {
        return jsonResponse(200, { packs: [], next: null });
      }
      if (typeof url === 'string' && url.includes('/sticker-favorites')) {
        return jsonResponse(200, { favorites: [] });
      }
      return jsonResponse(200, { packs: [importedPack] });
    });
    renderPage(fetchMock);

    await screen.findByText('Fun Cats');
    expect(screen.getByText(/Imported from Telegram · Private/)).toBeTruthy();
    const share = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    expect(share.title).toContain('personal use');
  });
});
