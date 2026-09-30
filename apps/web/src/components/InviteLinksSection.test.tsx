import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import type { GroupDetail } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { GroupPanel } from './GroupPanel';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-devteam',
  title: 'Dev team',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  memberCount: 6,
};

function detail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: 'u-you',
    members: [
      { userId: 'u-you', name: 'You', role: 'owner' },
      { userId: 'u-ana', name: 'Ana', role: 'member' },
    ],
    ais: [],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

function linkFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'link-1',
    label: 'Friends',
    tokenHint: 'ab12',
    uses: 1,
    maxUses: 10,
    expiresAt: null,
    revoked: false,
    createdAt: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

function stubFetch(
  links: Record<string, unknown>[] = [linkFixture()],
  options: { failRevoke?: boolean } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/invite-links')) {
      if (init?.method === 'DELETE') {
        if (options.failRevoke === true) {
          return jsonResponse(500, {
            error: { code: 'server_error', message: 'Try again later' },
          });
        }
        return new Response(null, { status: 204 });
      }
      if (init?.method === 'POST') {
        return jsonResponse(201, {
          id: 'link-9',
          token: 'f'.repeat(64),
          url: `http://localhost:5173/j/${'f'.repeat(64)}`,
        });
      }
      return jsonResponse(200, { links });
    }
    if (target.includes('/audit')) {
      return jsonResponse(200, { entries: [], next: null });
    }
    if (target.includes('/approval-rules')) {
      return jsonResponse(200, []);
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(seed: ChatStoreSeed = {}): void {
  const store = createChatStore({
    groupInfos: { 'c-devteam': detail() },
    ownedAis: [],
    ...seed,
  });
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <GroupPanel chat={chat} onClose={() => {}} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GroupPanel invite links (T-0115)', () => {
  it('lists links with hints (never tokens) for an owner', async () => {
    stubFetch();
    renderPanel();

    const section = await screen.findByRole('region', { name: 'Invite links' });
    expect(within(section).getByText('Friends')).toBeTruthy();
    expect(within(section).getByText(/1\/10 uses/)).toBeTruthy();
    expect(section.textContent).not.toContain('f'.repeat(16));
  });

  it('creates a link and shows the URL once with a Copy button', async () => {
    const fetchMock = stubFetch([]);
    renderPanel();

    const section = await screen.findByRole('region', { name: 'Invite links' });
    expect(within(section).getByText('No invite links yet.')).toBeTruthy();

    fireEvent.change(within(section).getByLabelText('Link label'), {
      target: { value: 'Friends' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Create invite link' }));

    expect(await within(section).findByText('Share this link')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Copy invite link' })).toBeTruthy();
    expect(within(section).getByText(/Anyone with this link can join/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/groups/g-devteam/invite-links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('revokes a link', async () => {
    const fetchMock = stubFetch();
    renderPanel();

    const section = await screen.findByRole('region', { name: 'Invite links' });
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Revoke invite link Friends' }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/groups/g-devteam/invite-links/link-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('hides the section for a plain member', async () => {
    stubFetch();
    renderPanel({
      groupInfos: {
        'c-devteam': detail({
          members: [
            { userId: 'u-ana', name: 'Ana', role: 'owner' },
            { userId: 'u-you', name: 'You', role: 'member' },
          ],
        }),
      },
    });

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Members' }).textContent).toContain('Ana'),
    );
    expect(screen.queryByRole('region', { name: 'Invite links' })).toBeNull();
  });

  it('unsticks the Revoke button and shows the error when revoking fails', async () => {
    // Fix 6: `revokingId` must clear when the revoke fails — otherwise the
    // button sticks on "Revoking..." and the user sees the error with no
    // way to retry.
    stubFetch(undefined, { failRevoke: true });
    renderPanel();

    const section = await screen.findByRole('region', { name: 'Invite links' });
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Revoke invite link Friends' }),
    );

    // The parent surfaces the failure...
    expect(await within(section).findByText('Try again later')).toBeTruthy();
    // ...and the button is clickable again (not stuck on "Revoking...").
    await waitFor(() => {
      expect(
        within(section).getByRole('button', { name: 'Revoke invite link Friends' }),
      ).toBeTruthy();
    });
    expect(within(section).queryByText('Revoking…')).toBeNull();
  });
});
