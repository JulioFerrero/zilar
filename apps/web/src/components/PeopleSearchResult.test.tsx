import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { PeopleSearchResult } from './PeopleSearchResult';
import { ContactProfileRow } from './ContactProfileRow';
import { ApiError, lookupByHandle, sendContactRequest } from '@/lib/api';
import { renderApp } from '@/test/renderApp';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    lookupByHandle: vi.fn(),
    sendContactRequest: vi.fn(),
    listContactRequests: vi.fn(async () => ({ incoming: [], outgoing: [] })),
    acceptContactRequest: vi.fn(),
    declineContactRequest: vi.fn(),
    cancelContactRequest: vi.fn(),
  };
});

const lookupMock = vi.mocked(lookupByHandle);
const sendMock = vi.mocked(sendContactRequest);

const PROFILE = {
  userId: 'u-ana',
  name: 'Ana',
  handle: 'taken_user',
  image: null,
  relation: 'none' as const,
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function searchFor(handle: string): Promise<void> {
  renderApp('/');
  const input = screen.getByLabelText('Search chats');
  fireEvent.change(input, { target: { value: `@${handle}` } });
}

async function flushTimers(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
}

describe('usePeopleSearch via the search bar', () => {
  it('shows the row only after 900 ms of no typing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockResolvedValue(PROFILE);
    await searchFor('taken_user');
    expect(lookupMock).not.toHaveBeenCalled();
    expect(screen.queryByText('People')).toBeNull();

    // Halfway there: still nothing (no per-keystroke lookup).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(lookupMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith('taken_user');
    expect(await screen.findByText('People')).toBeTruthy();
    expect(screen.getByText('@taken_user')).toBeTruthy();
  });

  it('looks up at once on Enter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockResolvedValue(PROFILE);
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.change(input, { target: { value: '@taken_user' } });
    expect(lookupMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('never looks up the same handle twice in a row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockResolvedValue(PROFILE);
    renderApp('/');
    const input = screen.getByLabelText('Search chats');

    fireEvent.change(input, { target: { value: '@taken_user' } });
    await flushTimers();
    expect(lookupMock).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lookupMock).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: '@taken_user2' } });
    await flushTimers();
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('shows the muted line for an unknown handle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockRejectedValue(new ApiError(404, 'not_found', 'No user with that username'));
    await searchFor('nobody_xyz');
    await flushTimers();
    expect(await screen.findByText('No one with that username.')).toBeTruthy();
  });

  it('shows the 429 notice once and does not retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockRejectedValue(new ApiError(429, 'rate_limited', 'Too many'));
    await searchFor('taken_user');
    await flushTimers();
    expect(await screen.findByText('Too many searches, try again in a few minutes.')).toBeTruthy();
    await flushTimers();
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('looks up a different handle after a 429', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'Too many'));
    lookupMock.mockResolvedValue(PROFILE);
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.change(input, { target: { value: '@taken_user' } });
    await flushTimers();
    expect(await screen.findByText('Too many searches, try again in a few minutes.')).toBeTruthy();

    fireEvent.change(input, { target: { value: '@taken_user2' } });
    await flushTimers();
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(lookupMock).toHaveBeenLastCalledWith('taken_user2');
  });

  it('retries after a transient error on Enter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockRejectedValueOnce(new Error('network down'));
    lookupMock.mockResolvedValue(PROFILE);
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.change(input, { target: { value: '@taken_user' } });
    await flushTimers();
    expect(await screen.findByText('Could not search for that username.')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('@taken_user')).toBeTruthy();
  });

  it('a stale lookup never overwrites a newer one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveSlow: ((profile: typeof PROFILE) => void) | undefined;
    lookupMock.mockImplementationOnce(
      () =>
        new Promise<typeof PROFILE>((resolve) => {
          resolveSlow = resolve;
        }),
    );
    lookupMock.mockResolvedValue({ ...PROFILE, name: 'Taken User2', handle: 'taken_user2' });
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.change(input, { target: { value: '@taken_user' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lookupMock).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: '@taken_user2' } });
    await flushTimers();
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Taken User2')).toBeTruthy();

    await act(async () => {
      resolveSlow?.(PROFILE);
    });
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Taken User2')).toBeTruthy();
  });

  it('an invalid handle shape shows the muted line without a lookup', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: '@ab' } });
    await flushTimers();
    expect(lookupMock).not.toHaveBeenCalled();
    expect(await screen.findByText('No one with that username.')).toBeTruthy();
  });

  it('never calls the lookup for text without @', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'ana' } });
    await flushTimers();
    expect(lookupMock).not.toHaveBeenCalled();
    expect(screen.queryByText('People')).toBeNull();
  });
});

describe('ContactProfileRow relations', () => {
  it('each relation shows the right action', () => {
    const store = createChatStore({
      chats: [
        {
          id: 'u-ana@zilar.test',
          title: 'Ana',
          kind: 'dm',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
        },
      ],
      contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'u-ana@zilar.test' }],
    });
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
      refetch: async () => {},
    };
    const cases = [
      ['contact', 'Message'],
      ['none', 'Add contact'],
      ['request_sent', 'Cancel'],
      ['request_received', 'Accept'],
    ] as const;
    for (const [relation, action] of cases) {
      const { unmount } = render(
        <AuthProvider value={auth}>
          <ChatStoreProvider store={store}>
            <MemoryRouter>
              <ContactProfileRow profile={{ ...PROFILE, relation }} onRelationChange={() => {}} />
            </MemoryRouter>
          </ChatStoreProvider>
        </AuthProvider>,
      );
      expect(screen.getByRole('button', { name: action })).toBeTruthy();
      if (relation === 'request_received') {
        expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
      }
      unmount();
    }
    const { unmount } = render(
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <MemoryRouter>
            <ContactProfileRow
              profile={{ ...PROFILE, relation: 'self' }}
              onRelationChange={() => {}}
            />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    expect(screen.getByText("That's you.")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
  });

  it('Message opens the DM chat for a contact', () => {
    const store = createChatStore({
      chats: [
        {
          id: 'u-ana@zilar.test',
          title: 'Ana',
          kind: 'dm',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
        },
      ],
      contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'u-ana@zilar.test' }],
    });
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
      refetch: async () => {},
    };
    const { unmount } = render(
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route
                path="/"
                element={
                  <ContactProfileRow
                    profile={{ ...PROFILE, relation: 'contact' }}
                    onRelationChange={() => {}}
                  />
                }
              />
              <Route path="/c/:chatId" element={<p>chat open</p>} />
            </Routes>
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByText('chat open')).toBeTruthy();
    unmount();
  });

  it('hides Message when no DM exists yet for the contact', () => {
    const store = createChatStore();
    const auth = {
      status: 'authenticated' as const,
      user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
      refetch: async () => {},
    };
    const { unmount } = render(
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <MemoryRouter>
            <ContactProfileRow
              profile={{ ...PROFILE, relation: 'contact' }}
              onRelationChange={() => {}}
            />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
    expect(screen.getAllByText("You're already contacts.")).toHaveLength(1);
    unmount();
  });

  it('Add contact sends the request and flips to Request sent', async () => {
    sendMock.mockResolvedValue({
      request: {
        id: 'r-1',
        fromUserId: 'u-you',
        toUserId: 'u-ana',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={createChatStore()}>
          <MemoryRouter>
            <ContactProfileRow profile={PROFILE} onRelationChange={() => {}} />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Request sent.')).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith('taken_user');
  });

  it('renders the People section directly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookupMock.mockResolvedValue(PROFILE);
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={createChatStore()}>
          <MemoryRouter>
            <PeopleSearchResult query="@taken_user" />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    await flushTimers();
    expect(await screen.findByText('People')).toBeTruthy();
  });
});

describe('new-chat menu without Add contact', () => {
  it('no longer has an Add contact entry', () => {
    renderApp('/');
    fireEvent.click(screen.getByLabelText('New chat'));
    expect(screen.queryByRole('menuitem', { name: 'Add contact' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'New group' })).toBeTruthy();
  });
});
