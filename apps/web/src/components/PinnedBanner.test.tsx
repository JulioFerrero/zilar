import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import type { Pin } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { PinnedBanner } from './PinnedBanner';

function pin(
  id: string,
  messageId: string,
  senderName: string,
  text: string,
  kind: Pin['kind'] = 'text',
): Pin {
  return {
    id,
    chat: 'c-x',
    messageId,
    senderName,
    text,
    kind,
    pinnedBy: 'u-you',
    pinnedAt: '2026-09-30T10:00:00Z',
  };
}

function dm(id: string, title: string): ChatSummary {
  return { id, title, kind: 'dm', isAI: false, space: 'personal', unread: 0, muted: false };
}

function textMessage(id: string, text: string, deleted = false): UiMessage {
  return {
    id,
    chatId: 'c-x',
    senderId: 'u-ana',
    senderName: 'Ana',
    text,
    createdAt: new Date('2026-09-30T10:00:00Z'),
    status: 'sent',
    ...(deleted ? { deleted: true } : {}),
  };
}

function renderBanner(pins: Pin[], messages: UiMessage[] = []) {
  const store = createChatStore({
    chats: [dm('c-x', 'Ana')],
    messagesByChat: { 'c-x': messages },
  });
  act(() => {
    store.setState({ pinsByChat: { 'c-x': pins } });
  });
  const result = render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <PinnedBanner chatId="c-x" />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { ...result, store };
}

describe('PinnedBanner', () => {
  it('renders nothing without pins or a pins error', () => {
    const { container } = renderBanner([]);
    expect(container.firstElementChild).toBeNull();
  });

  it('shows the sender and the snapshot of the first pin', () => {
    renderBanner([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    expect(screen.getByRole('button', { name: 'Jump to pinned message from Ana' })).toBeTruthy();
    expect(screen.getByText('Read this')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show next pinned message/ })).toBeNull();
  });

  it('shows a kind label for an attachment pin without text', () => {
    renderBanner([pin('pin-1', 'm-1', 'Ana', '', 'voice')]);
    expect(screen.getByText('Voice message')).toBeTruthy();
  });

  it('shows "Message deleted" once the loaded original is retracted', () => {
    renderBanner(
      [pin('pin-1', 'm-1', 'Ana', 'Read this')],
      [textMessage('m-1', 'Read this', true)],
    );
    expect(screen.getByText('Message deleted')).toBeTruthy();
    expect(screen.queryByText('Read this')).toBeNull();
  });

  it('cycles through several pins with the "1 of N" button', () => {
    renderBanner([pin('pin-2', 'm-2', 'Ben', 'Second'), pin('pin-1', 'm-1', 'Ana', 'First')]);
    expect(screen.getByText('Second')).toBeTruthy();
    const cycle = screen.getByRole('button', { name: 'Show next pinned message, 1 of 2' });
    expect(cycle.textContent).toBe('1 of 2');
    fireEvent.click(cycle);
    expect(screen.getByRole('button', { name: 'Jump to pinned message from Ana' })).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show next pinned message, 2 of 2' }));
    expect(screen.getByRole('button', { name: 'Jump to pinned message from Ben' })).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('opens the pins panel from the List button', () => {
    const { store } = renderBanner([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    fireEvent.click(screen.getByRole('button', { name: 'Open pinned messages, 1 pinned' }));
    expect(store.getState().pinsPanel).toEqual({ chatId: 'c-x' });
  });

  it('jumps to a loaded message without an error', async () => {
    const { store } = renderBanner(
      [pin('pin-1', 'm-1', 'Ana', 'Read this')],
      [textMessage('m-1', 'Read this')],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    await waitFor(() => expect(store.getState().activeChatId).toBe('c-x'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "Message not found" when the pinned message is not in history', async () => {
    renderBanner([pin('pin-1', 'ghost', 'Ana', 'Gone')]);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Message not found');
  });

  it('shows a pins error next to a non-empty banner, with a dismiss key', () => {
    const { store } = renderBanner([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    act(() => {
      store.setState({
        pinsError: { chatId: 'c-x', message: 'Could not unpin the message. Try again.' },
      });
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not unpin the message. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss pins error' }));
    expect(store.getState().pinsError).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows only the pins error when the chat has no pins', () => {
    const { store } = renderBanner([]);
    act(() => {
      store.setState({
        pinsError: { chatId: 'c-x', message: 'Could not pin the message. Try again.' },
      });
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not pin the message. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss pins error' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a pins error of another chat', () => {
    const { store } = renderBanner([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    act(() => {
      store.setState({ pinsError: { chatId: 'c-other', message: 'Other chat' } });
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
