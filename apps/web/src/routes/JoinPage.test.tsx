import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';
import { mockGroupDetails } from '@/mock/groups';
import { renderApp } from '@/test/renderApp';
import { JoinPage } from './JoinPage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete mockGroupDetails['c-full'];
});

function renderJoin(
  token: string,
  auth: 'signed-in' | 'guest' | 'nameless',
  pages: { openGroupChat?: (groupId: string) => Promise<string | undefined> } = {},
) {
  const value =
    auth === 'guest'
      ? { status: 'guest' as const, user: undefined, refetch: async () => {} }
      : auth === 'nameless'
        ? {
            status: 'authenticated' as const,
            user: { id: 'u-you', name: '  ', email: 'you@zilar.test' },
            refetch: async () => {},
          }
        : {
            status: 'authenticated' as const,
            user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
            refetch: async () => {},
          };
  render(
    <AuthProvider value={value}>
      <MemoryRouter initialEntries={[`/j/${token}`]}>
        <Routes>
          <Route
            path="/j/:token"
            element={
              <JoinPage
                openGroupChat={pages.openGroupChat ?? (async () => 'general-chat')}
                refreshChats={() => {}}
              />
            }
          />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/welcome/name" element={<div>Name page</div>} />
          <Route path="/c/:chatJid" element={<div>Group chat</div>} />
          <Route path="/" element={<div>Chats</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('JoinPage (T-0115)', () => {
  it('shows the preview card and opens the group chat on join', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/api/join/')) {
        if (init?.method === 'POST') {
          return jsonResponse(200, { groupId: 'g-1', alreadyMember: false });
        }
        return jsonResponse(200, {
          groupTitle: 'Hiking club',
          memberCount: 4,
          alreadyMember: false,
        });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderJoin('a'.repeat(64), 'signed-in', {
      openGroupChat: async (groupId: string) => {
        expect(groupId).toBe('g-1');
        return 'general-chat';
      },
    });

    expect(await screen.findByText('Hiking club')).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Join the group' }));
    await waitFor(() => expect(screen.getByText('Group chat')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/join/${'a'.repeat(64)}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to the chat list when the group chat id is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes('/api/join/') && init?.method === 'POST') {
          return jsonResponse(200, { groupId: 'g-1', alreadyMember: false });
        }
        return jsonResponse(200, {
          groupTitle: 'Hiking club',
          memberCount: 4,
          alreadyMember: false,
        });
      }),
    );
    renderJoin('a'.repeat(64), 'signed-in', { openGroupChat: async () => undefined });

    fireEvent.click(await screen.findByRole('button', { name: 'Join the group' }));
    await waitFor(() => expect(screen.getByText('Chats')).toBeTruthy());
  });

  it('shows an invalid card when the link is bad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: { code: 'invalid_link', message: 'bad' } })),
    );
    renderJoin('b'.repeat(64), 'signed-in');

    expect(await screen.findByText('Invite link not valid')).toBeTruthy();
  });

  it('shows the group-full card when the join answers 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes('/api/join/') && init?.method === 'POST') {
          return jsonResponse(409, { error: { code: 'group_full', message: 'full' } });
        }
        return jsonResponse(200, {
          groupTitle: 'Hiking club',
          memberCount: 50,
          alreadyMember: false,
        });
      }),
    );
    renderJoin('c'.repeat(64), 'signed-in');

    expect(await screen.findByText('Hiking club')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join the group' }));
    expect(await screen.findByText('This group is full')).toBeTruthy();
  });

  it('sends a signed-out visitor to the login with next=/j/<token>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { groupTitle: 'Hiking', memberCount: 2, alreadyMember: false }),
      ),
    );
    renderJoin('d'.repeat(64), 'guest');

    expect(await screen.findByText("You're invited")).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByText('Login page')).toBeTruthy();
  });

  it('gates a nameless signed-in user behind the name step, preserving the token', async () => {
    let posts = 0;
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/api/join/') && init?.method === 'POST') {
        posts += 1;
        return jsonResponse(200, { groupId: 'g-1', alreadyMember: false });
      }
      return jsonResponse(200, { groupTitle: 'Hiking', memberCount: 2, alreadyMember: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderJoin('d'.repeat(64), 'nameless');

    // The preview loads (so the card names the group), but the Join button
    // is replaced by the name gate — no join POST fires without a name.
    expect(await screen.findByText('Hiking')).toBeTruthy();
    expect(screen.getByText(/Choose a display name first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join the group' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Choose a name' }));
    expect(await screen.findByText('Name page')).toBeTruthy();
    expect(posts).toBe(0);
  });

  it('opens the group chat from the member preview without joining', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          groupTitle: 'Hiking club',
          memberCount: 4,
          alreadyMember: true,
          groupId: 'g-1',
        }),
      ),
    );
    renderJoin('e'.repeat(64), 'signed-in');

    expect(await screen.findByText("You're already a member of this group.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the group' }));
    expect(await screen.findByText('Group chat')).toBeTruthy();
  });

  it('shows the group-full card in mock mode for a group at the member cap', async () => {
    // Fix 7: the `full` state must be reachable through the mock HTTP
    // layer (a 50-member group the mock user is not in), not just through
    // a hand-stubbed fetch.
    mockGroupDetails['c-full'] = {
      id: 'g-full',
      title: 'Packed group',
      createdBy: 'u-full-0',
      members: Array.from({ length: 50 }, (_, index) => ({
        userId: `u-full-${index}`,
        name: `Full ${index}`,
        role: 'member' as const,
      })),
      ais: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) =>
        mockRequest(String(url), init ?? {}, { delayMs: 0 }),
      ),
    );
    const created = await mockRequest(
      '/groups/g-full/invite-links',
      { method: 'POST', body: '{}' },
      { delayMs: 0 },
    );
    const { token } = (await created.json()) as { token: string };
    renderApp(`/j/${token}`);

    expect(await screen.findByText('Packed group')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join the group' }));
    expect(await screen.findByText('This group is full')).toBeTruthy();
  });
});
