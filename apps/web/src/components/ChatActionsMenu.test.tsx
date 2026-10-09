import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatSummary } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreState } from '@/store/store';
import { ChatActionsMenu, ChatPrefMenuItems } from './ChatActionsMenu';

const auth = {
  status: 'authenticated' as const,
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function withChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return { ...chat, ...overrides };
}

function storeWith(chatRow: ChatSummary, overrides: Partial<ChatStoreState>) {
  const store = createChatStore({ chats: [chatRow] });
  store.setState(overrides);
  return store;
}

function Providers({
  store,
  children,
}: {
  store: ReturnType<typeof storeWith>;
  children: ReactNode;
}) {
  return (
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>{children}</ChatStoreProvider>
    </AuthProvider>
  );
}

function renderMenu(chatRow: ChatSummary = chat, overrides: Partial<ChatStoreState> = {}) {
  const onClose = vi.fn();
  render(
    <Providers store={storeWith(chatRow, overrides)}>
      <ChatActionsMenu chat={chatRow} onClose={onClose} />
    </Providers>,
  );
  return { onClose };
}

function renderItems(
  chatRow: ChatSummary = chat,
  overrides: Partial<ChatStoreState> = {},
  onDone = vi.fn(),
) {
  render(
    <Providers store={storeWith(chatRow, overrides)}>
      <ChatPrefMenuItems chat={chatRow} onDone={onDone}>
        <span>Extra item</span>
      </ChatPrefMenuItems>
    </Providers>,
  );
  return { onDone };
}

describe('ChatActionsMenu', () => {
  it('lists Pin, Mute and Archive for a chat that is neither pinned nor muted', () => {
    renderMenu();

    expect(screen.getByRole('menu', { name: 'Actions for Ana' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Pin Ana' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Mute Ana' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Archive chat Ana' })).toBeTruthy();
  });

  it('pins the chat, then closes the menu', async () => {
    const setPinned = vi.fn(async () => {});
    const { onClose } = renderMenu(chat, { setPinned });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));

    await waitFor(() => expect(setPinned).toHaveBeenCalledWith('c-ana', true));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('unpins a pinned chat', async () => {
    const setPinned = vi.fn(async () => {});
    renderMenu(withChat({ pinnedAt: new Date('2026-10-07T00:00:00.000Z') }), { setPinned });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Ana' }));

    await waitFor(() => expect(setPinned).toHaveBeenCalledWith('c-ana', false));
  });

  it('opens the mute durations and mutes for the chosen time, then closes', async () => {
    const setMuted = vi.fn(async () => {});
    const { onClose } = renderMenu(chat, { setMuted });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute Ana' }));
    expect(screen.getByRole('menuitem', { name: '1 hour' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Forever' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Unmute' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: '8 hours' }));

    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('c-ana', 'eight-hours'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('unmutes a muted chat from the duration list', async () => {
    const setMuted = vi.fn(async () => {});
    renderMenu(withChat({ muted: true }), { setMuted });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Change mute for Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unmute' }));

    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('c-ana', null));
  });

  it('archives a chat', async () => {
    const setArchived = vi.fn(async () => {});
    renderMenu(chat, { setArchived });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive chat Ana' }));

    await waitFor(() => expect(setArchived).toHaveBeenCalledWith('c-ana', true));
  });

  it('unarchives an archived chat', async () => {
    const setArchived = vi.fn(async () => {});
    renderMenu(withChat({ archived: true }), { setArchived });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive chat Ana' }));

    await waitFor(() => expect(setArchived).toHaveBeenCalledWith('c-ana', false));
  });

  it('shows the save sentence when the change is rejected', async () => {
    const setPinned = vi.fn(async () => {
      throw new Error('offline');
    });
    renderMenu(chat, { setPinned });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not save that change');
  });

  it('ignores a second click on the same item while its save waits', async () => {
    const setPinned = vi.fn(() => new Promise<void>(() => {}));
    renderMenu(chat, { setPinned });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));

    await waitFor(() => expect(setPinned).toHaveBeenCalledTimes(1));
  });

  it('runs two different items at the same time', async () => {
    const setPinned = vi.fn(() => new Promise<void>(() => {}));
    const setArchived = vi.fn(async () => {});
    renderMenu(chat, { setPinned, setArchived });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive chat Ana' }));

    await waitFor(() => expect(setPinned).toHaveBeenCalledWith('c-ana', true));
    await waitFor(() => expect(setArchived).toHaveBeenCalledWith('c-ana', true));
  });
});

describe('ChatPrefMenuItems', () => {
  it('renders its children after the Archive entry', () => {
    renderItems();

    expect(screen.getByText('Extra item')).toBeTruthy();
  });

  it('reports a saved change through onDone(false)', async () => {
    const setPinned = vi.fn(async () => {});
    const { onDone } = renderItems(chat, { setPinned });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Ana' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
  });

  it('reports a rejected change through onDone(true) and keeps the sentence', async () => {
    const setArchived = vi.fn(async () => {
      throw new Error('offline');
    });
    const { onDone } = renderItems(chat, { setArchived });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive chat Ana' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(screen.getByRole('alert').textContent).toBe('Could not save that change');
  });
});
