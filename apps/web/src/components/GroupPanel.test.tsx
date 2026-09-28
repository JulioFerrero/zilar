import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import type { GroupDetail, PublicAi } from '@/lib/api';
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

const devAi: GroupDetail['ais'][number] = {
  aiId: 'dev-1',
  jid: 'ai-dev-1@galena.test',
  name: 'Dev-1',
  ownerId: 'u-you',
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

function myAi(id: string, name: string): PublicAi {
  return {
    id,
    name,
    template: 'custom',
    persona: 'A helpful assistant.',
    model: 'gpt-4o',
    jid: `ai-${id}@galena.test`,
    status: 'active',
    providerConnectionId: 'conn-1',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

function seedWith(seed: ChatStoreSeed = {}): ChatStoreSeed {
  return { groupInfos: { 'c-devteam': detail() }, ownedAis: [], ...seed };
}

function renderStore(store: ReturnType<typeof createChatStore>, onClose = vi.fn()) {
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <GroupPanel chat={chat} onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return onClose;
}

function setup(seed: ChatStoreSeed = {}) {
  const store = createChatStore(seedWith(seed));
  const onClose = renderStore(store);
  return { store, onClose };
}

describe('GroupPanel', () => {
  it('lists the members and the AIs with their owner', () => {
    setup({ groupInfos: { 'c-devteam': detail({ ais: [devAi] }) } });

    const members = within(screen.getByRole('region', { name: 'Members' }));
    expect(members.getByText('You')).toBeTruthy();
    expect(members.getByText('Ana')).toBeTruthy();
    expect(members.getByText('owner')).toBeTruthy();

    const ais = within(screen.getByRole('region', { name: 'AIs' }));
    expect(ais.getByText('Dev-1')).toBeTruthy();
    expect(ais.getByText('AI')).toBeTruthy();
    expect(ais.getByText('Added by You')).toBeTruthy();
  });

  it('shows Add my AI for an owner with an eligible AI', async () => {
    setup({
      groupInfos: { 'c-devteam': detail({ ais: [devAi] }) },
      ownedAis: [myAi('dev-1', 'Dev-1'), myAi('marketing', 'Marketing AI')],
    });

    expect(await screen.findByRole('button', { name: 'Add my AI' })).toBeTruthy();
  });

  it('hides Add my AI for a member', async () => {
    setup({
      groupInfos: {
        'c-devteam': detail({
          members: [
            { userId: 'u-ana', name: 'Ana', role: 'owner' },
            { userId: 'u-you', name: 'You', role: 'member' },
          ],
          ais: [devAi],
        }),
      },
      ownedAis: [myAi('marketing', 'Marketing AI')],
    });

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Members' }).textContent).toContain('Ana'),
    );
    expect(screen.queryByRole('button', { name: 'Add my AI' })).toBeNull();
  });

  it('hides Add my AI when no owned AI is eligible', async () => {
    setup({
      groupInfos: { 'c-devteam': detail({ ais: [devAi] }) },
      ownedAis: [myAi('dev-1', 'Dev-1')],
    });

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'AIs' }).textContent).toContain('Dev-1'),
    );
    expect(screen.queryByRole('button', { name: 'Add my AI' })).toBeNull();
  });

  it('adds an AI through the store and shows it', async () => {
    const store = createChatStore(
      seedWith({
        groupInfos: { 'c-devteam': detail() },
        ownedAis: [myAi('marketing', 'Marketing AI')],
      }),
    );
    const addGroupAi = vi.fn(store.getState().addGroupAi);
    store.setState({ addGroupAi });
    renderStore(store);

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Marketing AI/ }));

    await waitFor(() => expect(addGroupAi).toHaveBeenCalledWith('c-devteam', 'marketing'));
    expect(await screen.findByText('Marketing AI')).toBeTruthy();
    const ais = within(screen.getByRole('region', { name: 'AIs' }));
    expect(ais.getByText('Marketing AI')).toBeTruthy();
  });

  it('removes an AI after a two-step confirm', async () => {
    const store = createChatStore(
      seedWith({ groupInfos: { 'c-devteam': detail({ ais: [devAi] }) } }),
    );
    const removeGroupAi = vi.fn(store.getState().removeGroupAi);
    store.setState({ removeGroupAi });
    renderStore(store);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dev-1 from the group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing Dev-1' }));

    await waitFor(() => expect(removeGroupAi).toHaveBeenCalledWith('c-devteam', 'dev-1'));
    await waitFor(() => expect(screen.queryByText('Dev-1')).toBeNull());
    expect(screen.getByText('No AIs in this group yet.')).toBeTruthy();
  });

  it('shows an inline error when an add fails, keeping the AI out', async () => {
    const store = createChatStore(
      seedWith({
        groupInfos: { 'c-devteam': detail() },
        ownedAis: [myAi('marketing', 'Marketing AI')],
      }),
    );
    store.setState({
      addGroupAi: async () => {
        throw new Error('The server is down');
      },
    });
    renderStore(store);

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Marketing AI/ }));

    expect((await screen.findByRole('alert')).textContent).toBe('The server is down');
    expect(store.getState().groupInfo('c-devteam')?.ais).toHaveLength(0);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
