import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { GroupHandleRoute } from './GroupHandleRoute';
import { lookupGroupByHandle } from '@/lib/api';
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
    lookupGroupByHandle: vi.fn(),
  };
});

const lookupMock = vi.mocked(lookupGroupByHandle);

const HIKING = {
  id: 'g-hiking',
  kind: 'group' as const,
  title: 'Hiking club',
  handle: 'hiking_club',
  description: 'Trail talk every Sunday.',
  memberCount: 12,
  joined: false,
};

function renderHandle(atHandle: string) {
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
          <GroupHandleRoute atHandle={atHandle} />
        </ChatStoreProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('GroupHandleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a card with title, description, member count and Join for a public group', async () => {
    lookupMock.mockResolvedValue(HIKING);
    renderHandle('hiking_club');

    expect(await screen.findByRole('dialog', { name: 'Join Hiking club' })).toBeTruthy();
    expect(screen.getByText('@hiking_club')).toBeTruthy();
    expect(screen.getByText('Trail talk every Sunday.')).toBeTruthy();
    expect(screen.getByText('12 members')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join the group' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join the group' }).getAttribute('data-slot')).toBe(
      'button',
    );
  });

  it('reads Open when already joined', async () => {
    lookupMock.mockResolvedValue({ ...HIKING, joined: true });
    renderHandle('hiking_club');

    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('falls back to the Add contact dialog for a person', async () => {
    const { ApiError } = await import('@/lib/api');
    lookupMock.mockRejectedValue(new ApiError(404, 'not_found', 'No public group'));
    renderHandle('ada');

    expect(await screen.findByRole('dialog', { name: 'Add contact' })).toBeTruthy();
  });

  it.each([
    {
      name: 'server error',
      error: { status: 500, code: 'internal_error' },
      text: 'Could not open that link. Try again.',
    },
    {
      name: 'rate limit',
      error: { status: 429, code: 'rate_limited' },
      text: 'Too many lookups — wait a little and try again.',
    },
    {
      name: 'network failure',
      error: { status: 0, code: 'network_error' },
      text: 'Could not open that link. Try again.',
    },
  ])(
    'shows an error state with Retry on $name, never the Add contact dialog',
    async ({ error, text }) => {
      const { ApiError } = await import('@/lib/api');
      lookupMock.mockRejectedValue(new ApiError(error.status, error.code, 'boom'));
      renderHandle('hiking_club');

      expect(await screen.findByRole('dialog', { name: 'Open @hiking_club' })).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe(text);
      expect(screen.queryByRole('dialog', { name: 'Add contact' })).toBeNull();

      // Retry re-runs the lookup: this time the group resolves.
      lookupMock.mockResolvedValue(HIKING);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('dialog', { name: 'Join Hiking club' })).toBeTruthy();
      expect(lookupMock).toHaveBeenCalledTimes(2);
    },
  );

  it('sends a logged-out visitor to login and back', async () => {
    const store = createChatStore();
    render(
      <MemoryRouter initialEntries={['/@hiking_club']}>
        <AuthProvider value={{ status: 'guest', user: undefined, refetch: async () => {} }}>
          <ChatStoreProvider store={store}>
            <Routes>
              <Route path="/:atHandle" element={<GroupHandleRoute atHandle="hiking_club" />} />
              <Route path="/login" element={<p>Sign in page</p>} />
            </Routes>
          </ChatStoreProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // The guest lands on the login stub (the real route returns to the
    // handle URL afterwards through `state.from`).
    expect(await screen.findByText('Sign in page')).toBeTruthy();
  });

  it('closes the group card with Escape', async () => {
    lookupMock.mockResolvedValue(HIKING);
    renderHandle('hiking_club');
    expect(await screen.findByRole('dialog', { name: 'Join Hiking club' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Join Hiking club' })).toBeNull();
  });

  it('closes the error card with Escape', async () => {
    const { ApiError } = await import('@/lib/api');
    lookupMock.mockRejectedValue(new ApiError(500, 'internal_error', 'boom'));
    renderHandle('hiking_club');
    expect(await screen.findByRole('dialog', { name: 'Open @hiking_club' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Open @hiking_club' })).toBeNull();
  });
});
