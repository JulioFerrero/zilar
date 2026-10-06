import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { ChatView } from './ChatView';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const group: ChatSummary = {
  id: 'c-devteam',
  title: 'Dev team',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  memberCount: 6,
};

const dm: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function renderView(
  chat: ChatSummary,
  path = '/c/c-devteam',
  seed: ChatStoreSeed = { chats: [group, dm] },
) {
  const store = createChatStore(seed);
  const tree = (next: ChatSummary) => (
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/c/:chatJid" element={<ChatView chat={next} />} />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>
  );
  return { rerender: render(tree(chat)).rerender, tree, store };
}

describe('ChatView panels', () => {
  it('opens the group panel from ?panel=group', () => {
    renderView(group, '/c/c-devteam?panel=group');

    expect(screen.getByRole('dialog', { name: 'Dev team info' })).toBeTruthy();
  });

  it('closes the panel when the chat changes and does not reopen it', () => {
    const { rerender, tree } = renderView(group);

    fireEvent.click(screen.getByRole('button', { name: 'Open Dev team info' }));
    expect(screen.getByRole('dialog', { name: 'Dev team info' })).toBeTruthy();

    rerender(tree(dm));
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(tree(group));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a PUBLIC tag in the header of a public group', () => {
    renderView({ ...group, visibility: 'public', handle: 'dev_team' });

    expect(screen.getByText('PUBLIC')).toBeTruthy();
  });
});

describe('ChatView forwarding (T-0419)', () => {
  it('opens the forward picker from a message menu', () => {
    const message: UiMessage = {
      id: 'm-1',
      chatId: 'c-devteam',
      senderId: 'u-ana',
      senderName: 'Ana',
      text: 'hello there',
      createdAt: new Date('2026-09-28T10:00:00Z'),
      status: 'read',
    };
    renderView(group, '/c/c-devteam', {
      chats: [group, dm],
      messagesByChat: { 'c-devteam': [message] },
    });

    fireEvent.contextMenu(screen.getByText('hello there'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forward' }));

    expect(screen.getByRole('dialog', { name: 'Forward' })).toBeTruthy();
  });
});

describe('ChatView forwarding multi-select (T-0439)', () => {
  function message(id: string, minute: number): UiMessage {
    return {
      id,
      chatId: 'c-devteam',
      senderId: 'u-ana',
      senderName: 'Ana',
      text: `message ${id}`,
      createdAt: new Date(2026, 8, 28, 10, minute),
      status: 'read',
    };
  }

  function renderSelecting() {
    const first = message('m-1', 1);
    const second = message('m-2', 2);
    const { store } = renderView(group, '/c/c-devteam', {
      chats: [group, dm],
      messagesByChat: { 'c-devteam': [first, second] },
    });
    const forwardMessages = vi.fn();
    store.setState({ forwardMessages });
    return { first, second, forwardMessages };
  }

  it('selects several messages and forwards them in chat order', () => {
    const { first, second, forwardMessages } = renderSelecting();

    fireEvent.contextMenu(screen.getByText('message m-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select' }));

    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getAllByLabelText('Select message')).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText('Select message')[1] as HTMLElement);
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    const picker = screen.getByRole('dialog', { name: 'Forward' });
    expect(picker).toBeTruthy();

    fireEvent.click(within(picker).getByText('Ana'));
    fireEvent.click(within(picker).getByRole('button', { name: 'Send' }));

    expect(forwardMessages).toHaveBeenCalledTimes(1);
    const [, messages] = forwardMessages.mock.calls[0] as [string[], UiMessage[]];
    expect(messages.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it('leaves select mode on Cancel', () => {
    renderSelecting();

    fireEvent.contextMenu(screen.getByText('message m-2'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.queryAllByLabelText('Select message')).toHaveLength(0);
  });

  it('leaves select mode on Escape', () => {
    renderSelecting();

    fireEvent.contextMenu(screen.getByText('message m-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('1 selected')).toBeNull();
  });
});

describe('ChatView media panel (T-0434)', () => {
  it('opens the media panel from the chat menu and closes it on Escape', async () => {
    renderView(dm, '/c/c-ana');

    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Media, files and links' }));

    expect(
      await screen.findByRole('dialog', { name: 'Media, files and links in Ana' }),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
