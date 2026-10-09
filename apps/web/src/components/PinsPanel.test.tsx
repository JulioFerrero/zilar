import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import type { Pin } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { PinsPanel } from './PinsPanel';

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

function renderPanel(pins: Pin[], messages: UiMessage[] = [], onClose = vi.fn()) {
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
        <PinsPanel chatId="c-x" onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { ...result, store, onClose };
}

describe('PinsPanel', () => {
  it('names the chat and says when nothing is pinned', () => {
    renderPanel([]);
    const dialog = screen.getByRole('dialog', { name: 'Pinned messages in Ana' });
    expect(within(dialog).getByText('Nothing pinned yet')).toBeTruthy();
    expect(
      within(dialog).getByText('Pin an important message from its menu to keep it at the top.'),
    ).toBeTruthy();
  });

  it('counts the pins with the singular or plural word', () => {
    const { unmount } = renderPanel([pin('pin-1', 'm-1', 'Ana', 'One')]);
    expect(screen.getByText('1 pin')).toBeTruthy();
    unmount();
    renderPanel([pin('pin-1', 'm-1', 'Ana', 'One'), pin('pin-2', 'm-2', 'Ben', 'Two')]);
    expect(screen.getByText('2 pins')).toBeTruthy();
  });

  it('lists the sender, the snapshot and a kind label for attachments', () => {
    renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this'), pin('pin-2', 'm-2', 'Ben', '', 'file')]);
    expect(screen.getByRole('button', { name: 'Jump to pinned message from Ana' })).toBeTruthy();
    expect(screen.getByText('Read this')).toBeTruthy();
    expect(screen.getByText('File')).toBeTruthy();
  });

  it('shows "Message deleted" for a retracted original', () => {
    renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this')], [textMessage('m-1', 'Read this', true)]);
    expect(screen.getByText('Message deleted')).toBeTruthy();
  });

  it('jumps to a loaded message, closes the panel and keeps no error', async () => {
    const { store, onClose } = renderPanel(
      [pin('pin-1', 'm-1', 'Ana', 'Read this')],
      [textMessage('m-1', 'Read this')],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(store.getState().activeChatId).toBe('c-x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "Message not found" and stays open when the message is not in history', async () => {
    const { onClose } = renderPanel([pin('pin-1', 'ghost', 'Ana', 'Gone')]);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Message not found');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unpins from the row and removes it from the list', async () => {
    const { store } = renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    // The real action calls the API; this test only needs the store to drop the pin.
    vi.spyOn(store.getState(), 'unpinMessage').mockImplementation(async (chatId, pinId) => {
      store.setState((state) => ({
        pinsByChat: {
          ...state.pinsByChat,
          [chatId]: (state.pinsByChat[chatId] ?? []).filter((entry) => entry.id !== pinId),
        },
      }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unpin message from Ana' }));
    await waitFor(() => expect(store.getState().pins('c-x')).toHaveLength(0));
    await waitFor(() => expect(screen.getByText('Nothing pinned yet')).toBeTruthy());
  });

  it('shows "Unpinning…" on the row while the unpin is pending', () => {
    const { store } = renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    vi.spyOn(store.getState(), 'unpinMessage').mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Unpin message from Ana' }));
    const button = screen.getByRole('button', { name: 'Unpin message from Ana' });
    expect(button.textContent).toBe('Unpinning…');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the failure message when the store drops the pin before the request fails', async () => {
    const { store } = renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    // Like the real action: the pin leaves the store first, then the request fails and the store puts it back.
    vi.spyOn(store.getState(), 'unpinMessage').mockImplementation(async (chatId, pinId) => {
      const before = store.getState().pins(chatId);
      store.setState((state) => ({
        pinsByChat: {
          ...state.pinsByChat,
          [chatId]: (state.pinsByChat[chatId] ?? []).filter((entry) => entry.id !== pinId),
        },
      }));
      await Promise.resolve();
      store.setState((state) => ({
        pinsByChat: { ...state.pinsByChat, [chatId]: before },
      }));
      throw new Error('offline');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unpin message from Ana' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not unpin. Try again.');
    expect(screen.getByRole('button', { name: 'Unpin message from Ana' }).textContent).toBe(
      'Unpin',
    );
  });

  it('reports a failed unpin inline and makes the row available again', async () => {
    const { store } = renderPanel([pin('pin-1', 'm-1', 'Ana', 'Read this')]);
    vi.spyOn(store.getState(), 'unpinMessage').mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Unpin message from Ana' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not unpin. Try again.');
    const button = screen.getByRole('button', { name: 'Unpin message from Ana' });
    expect(button.textContent).toBe('Unpin');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes on the header close button', () => {
    const { onClose } = renderPanel([]);
    fireEvent.click(screen.getByRole('button', { name: 'Close pinned messages' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
