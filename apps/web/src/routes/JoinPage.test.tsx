import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { JoinPage } from './JoinPage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderJoin(token: string, signedIn: boolean) {
  render(
    <AuthProvider
      value={
        signedIn
          ? {
              status: 'authenticated',
              user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
              refetch: async () => {},
            }
          : { status: 'guest', user: undefined, refetch: async () => {} }
      }
    >
      <MemoryRouter initialEntries={[`/j/${token}`]}>
        <Routes>
          <Route path="/j/:token" element={<JoinPage />} />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/" element={<div>Chats</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('JoinPage (T-0115)', () => {
  it('shows the preview card and joins on click', async () => {
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
    renderJoin('a'.repeat(64), true);

    expect(await screen.findByText('Hiking club')).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Join the group' }));
    await waitFor(() => expect(screen.getByText('Chats')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/join/${'a'.repeat(64)}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an invalid card when the link is bad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: { code: 'invalid_link', message: 'bad' } })),
    );
    renderJoin('b'.repeat(64), true);

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
    renderJoin('c'.repeat(64), true);

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
    renderJoin('d'.repeat(64), false);

    expect(await screen.findByText("You're invited")).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByText('Login page')).toBeTruthy();
  });

  it('offers to open the group when already a member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { groupTitle: 'Hiking club', memberCount: 4, alreadyMember: true }),
      ),
    );
    renderJoin('e'.repeat(64), true);

    expect(await screen.findByText("You're already a member of this group.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the group' }));
    expect(await screen.findByText('Chats')).toBeTruthy();
  });
});
