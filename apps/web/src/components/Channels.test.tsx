import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

function channelChat(role: 'owner' | 'admin' | 'member'): ChatSummary {
  return {
    id: 'c-acme',
    title: 'Acme Announcements',
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    memberCount: 3,
    chatKind: 'channel',
    subscriberCount: 3,
    description: 'Release notes and team news.',
    myRole: role,
  };
}

describe('channels', () => {
  it('shows the CHANNEL tag and megaphone in the list', () => {
    renderApp('/', { chats: [channelChat('member')] });

    expect(screen.getByText('CHANNEL')).toBeTruthy();
    expect(screen.getByLabelText('Channel')).toBeTruthy();
  });

  it('shows "N subscribers" in the header', () => {
    renderApp('/c/c-acme', { chats: [channelChat('member')] });

    expect(screen.getByText('3 subscribers')).toBeTruthy();
  });

  it('shows the recessed bar with Mute for subscribers, not the composer', async () => {
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('member')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-you',
          members: [
            { userId: 'u-you', name: 'You', role: 'member', roles: [] },
            { userId: 'u-ana', name: 'Ana', role: 'admin', roles: [] },
          ],
          ais: [],
        },
      },
    });

    expect(screen.getByText('Only admins can post here')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();

    const setMuted = vi.fn(async () => {});
    store.setState({ setMuted });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('c-acme', 'forever'));
  });

  it('shows the normal composer for admins', () => {
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('admin')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-you',
          members: [
            { userId: 'u-you', name: 'You', role: 'admin', roles: [] },
            { userId: 'u-ana', name: 'Ana', role: 'owner', roles: [] },
          ],
          ais: [],
        },
      },
    });

    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.queryByText('Only admins can post here')).toBeNull();
  });

  it('creates a channel from the New channel dialog', async () => {
    const room: ChatSummary = {
      id: 'new-channel@rooms.zilar.test',
      title: 'Releases',
      kind: 'group',
      isAI: false,
      space: 'personal',
      unread: 0,
      muted: false,
      memberCount: 1,
      chatKind: 'channel',
      subscriberCount: 1,
      description: 'Ship notes',
      myRole: 'owner',
    };
    const { store } = renderApp('/', {
      chats: [],
      contacts: [{ userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' }],
    });
    const createChannel = vi.fn(async () => {
      store.setState((state) => ({ chats: [...state.chats, room] }));
      return room.id;
    });
    store.setState({ createChannel });

    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New channel' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: 'Releases' } });
    fireEvent.change(screen.getByLabelText('Channel description'), {
      target: { value: 'Ship notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // T-0164: the dialog passes visibility options as a fourth argument
    // (undefined for a private channel).
    await waitFor(() =>
      expect(createChannel).toHaveBeenCalledWith('Releases', ['u-ana'], 'Ship notes', undefined),
    );
    // Scoped to the chat list: the dialog's own "Releases" input also
    // matches a bare text query once the row paints.
    const list = within(screen.getByRole('navigation', { name: 'Chats' }));
    expect(await list.findByText('Releases')).toBeTruthy();
  });

  it('leaves the channel from the panel', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/groups/g-acme/members')) {
        return new Response(
          JSON.stringify({
            members: [{ userId: 'u-ana', name: 'Ana', role: 'owner', roles: [] }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope' } }), {
        status: 404,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('member')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-ana',
          members: [],
          ais: [],
        },
      },
    });
    const leaveChannel = vi.fn(async () => {});
    store.setState({ leaveChannel });

    fireEvent.click(screen.getByLabelText('Open Acme Announcements channel info'));
    fireEvent.click(screen.getByRole('button', { name: 'Leave channel' }));
    await waitFor(() => expect(leaveChannel).toHaveBeenCalledWith('c-acme'));
  });

  it('shows the description and subscriber count in the panel', () => {
    renderApp('/c/c-acme', { chats: [channelChat('owner')] });

    fireEvent.click(screen.getByLabelText('Open Acme Announcements channel info'));
    const dialog = screen.getByRole('dialog', { name: 'Acme Announcements channel info' });
    expect(dialog.textContent).toContain('Release notes and team news.');
    expect(dialog.textContent).toContain('3 subscribers');
  });

  it('shows the admins to a subscriber by calling the members endpoint', async () => {
    // The subscriber's detail carries no audience (the server strips it),
    // so the panel loads the admins slice through the members endpoint.
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/groups/g-acme/members')) {
        return new Response(
          JSON.stringify({
            members: [{ userId: 'u-ana', name: 'Ana', role: 'owner', roles: [] }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope' } }), {
        status: 404,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('member')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-ana',
          members: [],
          ais: [],
        },
      },
    });

    fireEvent.click(screen.getByLabelText('Open Acme Announcements channel info'));
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/groups/g-acme/members'),
      expect.anything(),
    );
  });

  it('shows an error when the admins cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('member')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-ana',
          members: [],
          ais: [],
        },
      },
    });

    fireEvent.click(screen.getByLabelText('Open Acme Announcements channel info'));
    // Scoped to the Admins section: with every fetch failing, other panel
    // sections surface the same network text in their own alerts.
    const admins = within(screen.getByRole('region', { name: 'Admins' }));
    expect(await admins.findByText('Could not reach the server')).toBeTruthy();
  });

  it('keeps the Revoke button busy until a slow channel revoke settles (T-0141)', async () => {
    // The channel panel passes the revoke promise through (like GroupPanel),
    // so the button stays busy until the awaited DELETE settles instead of
    // flipping back on the next microtask.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const link = {
      id: 'link-1',
      label: 'Friends',
      tokenHint: 'ab12',
      uses: 1,
      maxUses: 10,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-09-30T10:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.includes('/invite-links')) {
          if (init?.method === 'DELETE') {
            await gate;
            return new Response(null, { status: 204 });
          }
          return new Response(JSON.stringify({ links: [link] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope' } }), {
          status: 404,
        });
      }),
    );
    const { store } = renderApp('/c/c-acme', { chats: [channelChat('owner')] });
    store.setState({
      groupInfos: {
        'c-acme': {
          id: 'g-acme',
          title: 'Acme Announcements',
          createdBy: 'u-you',
          members: [{ userId: 'u-you', name: 'You', role: 'owner', roles: [] }],
          ais: [],
        },
      },
    });

    fireEvent.click(screen.getByLabelText('Open Acme Announcements channel info'));
    const dialog = screen.getByRole('dialog', { name: 'Acme Announcements channel info' });
    const section = within(dialog).getByRole('region', { name: 'Invite links' });
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Revoke invite link Friends' }),
    );

    // Busy while the DELETE is still in flight…
    expect(await within(section).findByText('Revoking…')).toBeTruthy();
    expect(
      within(section).getByRole('button', { name: 'Revoke invite link Friends' }),
    ).toHaveProperty('disabled', true);
    // …and clickable again only after it settles.
    release();
    await waitFor(() => {
      expect(
        within(section).getByRole('button', { name: 'Revoke invite link Friends' }),
      ).toBeTruthy();
    });
    expect(within(section).queryByText('Revoking…')).toBeNull();
  });
});
