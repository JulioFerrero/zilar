import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from '@/lib/api';
import { GifPanel, gifPreviewUrl } from '@/components/GifPanel';
import { mockGifItems } from '@/mock/helpers';

const gifItems = [
  {
    id: 'gif-1',
    title: 'Dancing cat',
    mediaToken: 'token-1',
    kind: 'video' as const,
    width: 200,
    height: 150,
  },
  {
    id: 'gif-2',
    title: 'Laughing dog',
    mediaToken: 'token-2',
    kind: 'image' as const,
    width: 200,
    height: 200,
  },
];

beforeEach(() => {
  vi.spyOn(api, 'trendingGifs').mockImplementation(() => Promise.resolve({ items: gifItems }));
  vi.spyOn(api, 'searchGifs').mockImplementation((query: string) =>
    Promise.resolve({
      items: gifItems.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
    }),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

describe('GifPanel', () => {
  it('loads trending on open and shows the attribution', async () => {
    const onPick = vi.fn();
    render(<GifPanel onPick={onPick} />);
    const grid = await screen.findByRole('grid', { name: 'GIFs' });
    expect(within(grid).getByLabelText('Send Dancing cat')).toBeTruthy();
    expect(screen.getByText('Powered by Giphy')).toBeTruthy();
    fireEvent.click(within(grid).getByLabelText('Send Dancing cat'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ id: 'gif-1', kind: 'video' });
  });

  it('debounces search: rapid typing fires one request for the last query', async () => {
    vi.useFakeTimers();
    try {
      render(<GifPanel onPick={() => {}} />);
      await vi.advanceTimersByTimeAsync(0);
      const search = screen.getByLabelText('Search GIFs');
      fireEvent.change(search, { target: { value: 'd' } });
      fireEvent.change(search, { target: { value: 'do' } });
      fireEvent.change(search, { target: { value: 'dog' } });
      expect(api.searchGifs).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(api.searchGifs).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.searchGifs).mock.calls[0]?.[0]).toBe('dog');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the in-flight request when the query changes', async () => {
    const staleItem = gifItems[0]!;
    const freshItem = { ...gifItems[1]!, id: 'gif-fresh', title: 'Fresh dog' };
    let resolveFirst!: (page: { items: typeof gifItems }) => void;
    // No abort listener on purpose: like a fetch that completed in the same
    // tick as the abort, the promise settles normally after the abort fired,
    // so only the `signal.aborted` guard in the continuation can drop it.
    vi.mocked(api.searchGifs).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    vi.mocked(api.searchGifs).mockImplementationOnce(() => Promise.resolve({ items: [freshItem] }));
    render(<GifPanel onPick={() => {}} />);
    const search = await screen.findByLabelText('Search GIFs');
    fireEvent.change(search, { target: { value: 'cat' } });
    await waitFor(() => expect(api.searchGifs).toHaveBeenCalledTimes(1));
    fireEvent.change(search, { target: { value: 'dog' } });
    // Wait until the debounced second load has started: by then it already
    // aborted the first controller, so resolving the stale request late must
    // drop it instead of overwriting the grid.
    await waitFor(() => expect(api.searchGifs).toHaveBeenCalledTimes(2));
    resolveFirst({ items: [staleItem, ...gifItems.slice(1)] });
    const grid = await screen.findByRole('grid', { name: 'GIFs' });
    await waitFor(() => expect(within(grid).getByLabelText('Send Fresh dog')).toBeTruthy());
    expect(within(grid).queryByLabelText('Send Dancing cat')).toBeNull();
  });

  it('shows still frames under prefers-reduced-motion', async () => {
    render(<GifPanel onPick={() => {}} />);
    await screen.findByRole('grid', { name: 'GIFs' });
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(document.querySelector('video')?.autoplay).toBe(false);
  });

  it('paginates with infinite scroll', async () => {
    vi.mocked(api.trendingGifs)
      .mockResolvedValueOnce({ items: gifItems, nextPos: '25' })
      .mockResolvedValueOnce({ items: [], nextPos: undefined });
    render(<GifPanel onPick={() => {}} />);
    const grid = await screen.findByRole('grid', { name: 'GIFs' });
    Object.defineProperty(grid, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(grid, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(grid, 'scrollTop', { value: 900, configurable: true });
    fireEvent.scroll(grid);
    await waitFor(() => expect(api.trendingGifs).toHaveBeenCalledTimes(2));
  });

  it('shows empty, error and unavailable states', async () => {
    // Empty search.
    vi.mocked(api.searchGifs).mockResolvedValueOnce({ items: [] });
    const first = render(<GifPanel onPick={() => {}} />);
    await screen.findByRole('grid', { name: 'GIFs' });
    fireEvent.change(screen.getByLabelText('Search GIFs'), { target: { value: 'zzz-no-match' } });
    await waitFor(() => expect(screen.getByText(/No GIFs found/)).toBeTruthy());
    first.unmount();

    // Error with retry.
    vi.mocked(api.trendingGifs).mockRejectedValueOnce(new Error('down'));
    const second = render(<GifPanel onPick={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Could not load GIFs/)).toBeTruthy());
    vi.mocked(api.trendingGifs).mockResolvedValueOnce({ items: gifItems });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('grid', { name: 'GIFs' })).toBeTruthy());
    second.unmount();

    // A provider outage (retryable 502) shows the same Retry state, never
    // the empty "No GIFs found" text.
    vi.mocked(api.trendingGifs).mockRejectedValueOnce(
      new api.ApiError(502, 'gif_search_failed', 'GIF search failed, try again later'),
    );
    const third = render(<GifPanel onPick={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Could not load GIFs/)).toBeTruthy());
    expect(screen.queryByText(/No GIFs found/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    third.unmount();

    // Unavailable hides the tab content.
    vi.mocked(api.trendingGifs).mockRejectedValueOnce(
      new api.ApiError(501, 'gifs_unavailable', 'off'),
    );
    render(<GifPanel onPick={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('GIFs are not available on this server.')).toBeTruthy(),
    );
  });

  it('resolves proxy URLs for real items and data URLs for mock art', () => {
    expect(gifPreviewUrl({ mediaToken: 'token-1' })).toBe('/api/gifs/media/token-1');
    expect(
      gifPreviewUrl({ mediaToken: mockGifItems()[0]?.mediaToken ?? '' }).startsWith('data:image/'),
    ).toBe(true);
  });

  it('renders mock mode placeholders without a server', () => {
    render(<GifPanel onPick={() => {}} mockItems={mockGifItems()} />);
    expect(screen.getByRole('grid', { name: 'GIFs' })).toBeTruthy();
    expect(api.trendingGifs).not.toHaveBeenCalled();
  });
});
