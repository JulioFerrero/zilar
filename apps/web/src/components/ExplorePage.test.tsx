import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ExplorePage } from './ExplorePage';
import { searchDirectory } from '@/lib/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ApiError: class ApiError extends Error {
      readonly status: number;
      readonly code: string;
      constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
      }
    },
    searchDirectory: vi.fn(),
  };
});

const searchMock = vi.mocked(searchDirectory);

const HIKING = {
  id: 'g-hiking',
  kind: 'group' as const,
  title: 'Hiking club',
  handle: 'hiking_club',
  description: 'Trail talk every Sunday.',
  memberCount: 12,
  joined: false,
  // T-0165: the group's picture rides the directory entry.
  avatarUrl: '/api/avatars/g-hiking',
};

const RELEASES = {
  id: 'g-releases',
  kind: 'channel' as const,
  title: 'Releases',
  handle: 'releases',
  description: 'Ship notes.',
  memberCount: 120,
  joined: true,
};

function renderExplore(onClose: () => void = () => {}) {
  const store = createChatStore();
  return render(
    <MemoryRouter>
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <ExplorePage onClose={onClose} />
        </ChatStoreProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ExplorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue({ entries: [], next: null });
  });

  it('lists the newest public rows with title, handle, description, count and Join', async () => {
    searchMock.mockResolvedValue({ entries: [HIKING], next: null });
    const { container } = renderExplore();

    expect(await screen.findByText('Hiking club')).toBeTruthy();
    expect(screen.getByText('@hiking_club')).toBeTruthy();
    expect(screen.getByText('Trail talk every Sunday.')).toBeTruthy();
    expect(screen.getByText('12 members')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' }).getAttribute('data-slot')).toBe('button');
    // T-0165: the directory entry's picture paints the row.
    expect(container.querySelector('img[src="/api/avatars/g-hiking"]')).not.toBeNull();
  });

  it('searches by query with at least 2 characters and filters by kind', async () => {
    searchMock.mockResolvedValue({ entries: [RELEASES], next: null });
    renderExplore();

    fireEvent.change(screen.getByLabelText('Search public groups and channels'), {
      target: { value: 'rel' },
    });
    await waitFor(() =>
      expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'rel' })),
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Channels' }));
    await waitFor(() =>
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'rel', kind: 'channel' }),
      ),
    );
    expect(await screen.findByText('Releases')).toBeTruthy();
    // Already joined: the button reads Open.
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('waits for a second character instead of searching', async () => {
    renderExplore();
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Search public groups and channels'), {
      target: { value: 'h' },
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    // Still one call (the initial empty listing): no 1-char search.
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a real empty state when nothing matches', async () => {
    searchMock.mockResolvedValue({ entries: [], next: null });
    renderExplore();

    fireEvent.change(screen.getByLabelText('Search public groups and channels'), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText(/Nothing public matches/)).toBeTruthy();
  });

  it('shows a real error state with Retry', async () => {
    searchMock.mockRejectedValueOnce(new Error('down'));
    renderExplore();

    expect(await screen.findByRole('alert')).toBeTruthy();
    searchMock.mockResolvedValue({ entries: [HIKING], next: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Hiking club')).toBeTruthy();
  });

  it('pages with Show more', async () => {
    searchMock.mockResolvedValueOnce({ entries: [HIKING], next: 'cursor-1' });
    searchMock.mockResolvedValueOnce({ entries: [RELEASES], next: null });
    renderExplore();

    expect(await screen.findByText('Hiking club')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Releases')).toBeTruthy();
    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' }));
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    renderExplore(onClose);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the search as the kit TextInput and focuses it initially', async () => {
    renderExplore();

    const search = screen.getByLabelText('Search public groups and channels');
    expect(search.className).toContain('well-surface');
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});
