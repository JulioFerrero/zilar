import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import { MemoryRouter } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ApiError, type GroupDetail, type PublicAi } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { ChannelPanel } from './ChannelPanel';

type Answer = (method: string, path: string) => Response | undefined;
type ChannelCall = Mock<(chatId: string) => Promise<void>>;
type MemberCall = Mock<(chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>>;
type AiCall = Mock<(chatId: string, aiId: string) => Promise<void>>;

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const channel: ChatSummary = {
  id: 'c-chan',
  title: 'Team news',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  memberCount: 3,
  subscriberCount: 3,
  description: 'Weekly news',
};

const devAi: GroupDetail['ais'][number] = {
  aiId: 'dev-1',
  jid: 'ai-dev-1@zilar.test',
  name: 'Dev-1',
  ownerId: 'u-you',
};

function detail(myRole: 'owner' | 'admin' | 'member', overrides: Partial<GroupDetail> = {}) {
  return {
    id: 'g-chan',
    title: 'Team news',
    createdBy: 'u-you',
    members: [
      { userId: 'u-you', name: 'You', role: myRole },
      { userId: 'u-ana', name: 'Ana', role: 'admin' as const },
      { userId: 'u-bo', name: 'Bo', role: 'member' as const },
    ],
    ais: [],
    ...overrides,
  } satisfies GroupDetail;
}

function myAi(id: string, name: string): PublicAi {
  return {
    id,
    name,
    template: 'custom',
    persona: 'A helpful assistant.',
    model: 'gpt-4o',
    jid: `ai-${id}@zilar.test`,
    status: 'active',
    providerConnectionId: 'conn-1',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

const membersBody = {
  members: [
    { userId: 'u-ana', name: 'Ana', role: 'admin' },
    { userId: 'u-bo', name: 'Bo', role: 'member' },
  ],
};

// The answers every panel test shares; a test's own answer runs first.
function sharedAnswer(method: string, path: string): Response | undefined {
  if (path.includes('/audit')) {
    return jsonResponse(200, { entries: [], next: null });
  }
  if (path.includes('/approval-rules')) {
    return jsonResponse(200, []);
  }
  if (path.includes('/invite-links') && method === 'GET') {
    return jsonResponse(200, { links: [] });
  }
  if (path.endsWith('/members')) {
    return jsonResponse(200, membersBody);
  }
  return undefined;
}

function stubApi(answer: Answer = () => undefined) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    return (
      answer(method, path) ??
      sharedAnswer(method, path) ??
      jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

interface PanelSetup {
  myRole?: 'owner' | 'admin' | 'member';
  noInfo?: boolean;
  info?: Partial<GroupDetail>;
  ownedAis?: PublicAi[];
  answer?: Answer;
  leaveChannel?: ChannelCall;
  changeChannelRole?: MemberCall;
  addGroupAi?: AiCall;
  removeGroupAi?: AiCall;
}

function renderPanel(options: PanelSetup = {}) {
  const store = createChatStore({
    currentUserId: 'u-you',
    ownedAis: options.ownedAis ?? [],
    groupInfos:
      options.noInfo === true ? {} : { 'c-chan': detail(options.myRole ?? 'member', options.info) },
  });
  store.setState({
    ...(options.leaveChannel !== undefined && { leaveChannel: options.leaveChannel }),
    ...(options.changeChannelRole !== undefined && {
      changeChannelRole: options.changeChannelRole,
    }),
    ...(options.addGroupAi !== undefined && { addGroupAi: options.addGroupAi }),
    ...(options.removeGroupAi !== undefined && { removeGroupAi: options.removeGroupAi }),
  });
  stubApi(options.answer);
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <ChannelPanel chat={channel} onClose={onClose} />
        </ChatStoreProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChannelPanel', () => {
  it('shows the subscriber count and the description', () => {
    renderPanel({ myRole: 'member' });

    expect(screen.getByText('3 subscribers')).toBeTruthy();
    expect(screen.getByText('Weekly news')).toBeTruthy();
  });

  it('shows the loading line until the group info arrives', () => {
    renderPanel({ noInfo: true });

    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows a subscriber the admins who post, never the audience', async () => {
    renderPanel({ myRole: 'member' });

    const admins = within(await screen.findByRole('region', { name: 'Admins' }));
    expect(admins.getByText('Ana')).toBeTruthy();
    expect(admins.queryByText('Bo')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Subscribers' })).toBeNull();
  });

  it('shows a subscriber the server message when the admins cannot load', async () => {
    renderPanel({
      myRole: 'member',
      answer: (_method, path) =>
        path.endsWith('/members')
          ? jsonResponse(500, { error: { code: 'server_error', message: 'Members are hidden' } })
          : undefined,
    });

    expect(await screen.findByText('Members are hidden')).toBeTruthy();
  });

  it('leaves the channel for a subscriber and closes the panel', async () => {
    const leaveChannel = vi.fn<(chatId: string) => Promise<void>>(async () => {});
    const { onClose } = renderPanel({ myRole: 'member', leaveChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Leave channel' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(leaveChannel).toHaveBeenCalledWith('c-chan');
  });

  it('shows the server message when leaving fails, and the button works again', async () => {
    const leaveChannel = vi
      .fn<(chatId: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(409, 'last_owner', 'Owners cannot leave yet'));
    renderPanel({ myRole: 'member', leaveChannel });

    fireEvent.click(screen.getByRole('button', { name: 'Leave channel' }));

    expect(await screen.findByText('Owners cannot leave yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave channel' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('shows an owner the whole audience with roles', () => {
    renderPanel({ myRole: 'owner' });

    const subscribers = within(screen.getByRole('region', { name: 'Subscribers' }));
    expect(subscribers.getByText('You')).toBeTruthy();
    expect(subscribers.getByText('Ana')).toBeTruthy();
    expect(subscribers.getByText('Bo')).toBeTruthy();
    expect(subscribers.getByText('owner')).toBeTruthy();
    expect(subscribers.getByText('admin')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Admins' })).toBeNull();
  });

  it('shows an owner an empty invite link list', async () => {
    renderPanel({ myRole: 'owner' });

    const links = within(await screen.findByRole('region', { name: 'Invite links' }));
    expect(await links.findByText('No invite links yet.')).toBeTruthy();
  });

  it('creates an invite link and shows its URL once', async () => {
    renderPanel({
      myRole: 'owner',
      answer: (method, path) =>
        method === 'POST' && path.endsWith('/invite-links')
          ? jsonResponse(201, {
              id: 'link-9',
              token: 't'.repeat(8),
              url: 'https://zilar.test/i/abc',
            })
          : undefined,
    });

    const links = within(await screen.findByRole('region', { name: 'Invite links' }));
    fireEvent.click(links.getByRole('button', { name: 'Create invite link' }));

    expect(await links.findByText('Share this link')).toBeTruthy();
    expect(links.getByText('https://zilar.test/i/abc')).toBeTruthy();
  });

  it('shows the server message when creating an invite link fails', async () => {
    renderPanel({
      myRole: 'owner',
      answer: (method, path) =>
        method === 'POST' && path.endsWith('/invite-links')
          ? jsonResponse(400, { error: { code: 'invalid_request', message: 'Too many links' } })
          : undefined,
    });

    const links = within(await screen.findByRole('region', { name: 'Invite links' }));
    fireEvent.click(links.getByRole('button', { name: 'Create invite link' }));

    expect(await links.findByText('Too many links')).toBeTruthy();
  });

  it('revokes an invite link', async () => {
    let revoked = false;
    const answer: Answer = (method, path) => {
      if (method === 'DELETE' && path.endsWith('/invite-links/link-1')) {
        revoked = true;
        return jsonResponse(204, null);
      }
      if (method === 'GET' && path.endsWith('/invite-links')) {
        return jsonResponse(200, {
          links: [
            {
              id: 'link-1',
              label: 'Friends',
              tokenHint: 'ab12',
              uses: 1,
              maxUses: 10,
              expiresAt: null,
              revoked: false,
              createdAt: '2026-09-30T10:00:00.000Z',
            },
          ],
        });
      }
      return undefined;
    };
    renderPanel({ myRole: 'owner', answer });

    const links = within(await screen.findByRole('region', { name: 'Invite links' }));
    fireEvent.click(await links.findByRole('button', { name: 'Revoke invite link Friends' }));

    await waitFor(() => expect(revoked).toBe(true));
  });

  it('shows the fixed sentence when the invite links cannot load', async () => {
    renderPanel({
      myRole: 'owner',
      answer: (method, path) =>
        method === 'GET' && path.endsWith('/invite-links')
          ? jsonResponse(500, { error: { code: 'server_error', message: 'boom' } })
          : undefined,
    });

    const links = within(await screen.findByRole('region', { name: 'Invite links' }));
    expect(await links.findByText('Could not load the invite links.')).toBeTruthy();
  });

  it('names each AI in the channel and who added it', () => {
    renderPanel({ myRole: 'owner', info: { ais: [devAi] } });

    const ais = within(screen.getByRole('region', { name: 'AIs' }));
    expect(ais.getByText('Dev-1')).toBeTruthy();
    expect(ais.getByText('Added by You')).toBeTruthy();
  });

  it('adds one of the owner AIs from the picker', async () => {
    const addGroupAi = vi.fn<(chatId: string, aiId: string) => Promise<void>>(async () => {});
    renderPanel({
      myRole: 'owner',
      ownedAis: [myAi('ai-helper', 'Helper')],
      addGroupAi,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Helper/ }));

    await waitFor(() => expect(addGroupAi).toHaveBeenCalledWith('c-chan', 'ai-helper'));
  });

  it('shows the AI sentence when adding an AI fails', async () => {
    const addGroupAi = vi
      .fn<(chatId: string, aiId: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(404, 'not_found', 'gone'));
    renderPanel({
      myRole: 'owner',
      ownedAis: [myAi('ai-helper', 'Helper')],
      addGroupAi,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Helper/ }));

    expect(await screen.findByText('That AI no longer exists.')).toBeTruthy();
  });

  it('removes an AI from the channel after a confirmation', async () => {
    const removeGroupAi = vi.fn<(chatId: string, aiId: string) => Promise<void>>(async () => {});
    renderPanel({ myRole: 'owner', info: { ais: [devAi] }, removeGroupAi });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dev-1 from the channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing Dev-1' }));

    await waitFor(() => expect(removeGroupAi).toHaveBeenCalledWith('c-chan', 'dev-1'));
  });

  it('promotes a subscriber to admin', async () => {
    const changeChannelRole = vi.fn<
      (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>
    >(async () => {});
    renderPanel({ myRole: 'owner', changeChannelRole });

    fireEvent.click(screen.getByRole('button', { name: 'Promote Bo to admin' }));

    await waitFor(() => expect(changeChannelRole).toHaveBeenCalledWith('c-chan', 'u-bo', 'admin'));
  });

  it('shows the server message when a role change fails', async () => {
    const changeChannelRole = vi
      .fn<(chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(403, 'forbidden', 'Only the owner can change roles'));
    renderPanel({ myRole: 'owner', changeChannelRole });

    fireEvent.click(screen.getByRole('button', { name: 'Promote Bo to admin' }));

    expect(await screen.findByText('Only the owner can change roles')).toBeTruthy();
  });

  it("shows the store's own sentence when a role change rejects with a plain Error", async () => {
    const changeChannelRole = vi
      .fn<(chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>>()
      .mockRejectedValueOnce(new Error('Only admins can do that'));
    renderPanel({ myRole: 'owner', changeChannelRole });

    fireEvent.click(screen.getByRole('button', { name: 'Promote Bo to admin' }));

    expect(await screen.findByText('Only admins can do that')).toBeTruthy();
  });

  it('shows the fixed sentence when a role change rejects with a non-Error', async () => {
    const changeChannelRole = vi
      .fn<(chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>>()
      .mockRejectedValueOnce('boom');
    renderPanel({ myRole: 'owner', changeChannelRole });

    fireEvent.click(screen.getByRole('button', { name: 'Promote Bo to admin' }));

    expect(await screen.findByText('Could not change the role.')).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('closes the panel from its close button', () => {
    const { onClose } = renderPanel({ myRole: 'member' });

    fireEvent.click(screen.getByRole('button', { name: 'Close channel panel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
