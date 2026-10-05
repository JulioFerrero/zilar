import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
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

function renderView(chat: ChatSummary, path = '/c/c-devteam') {
  const store = createChatStore({ chats: [group, dm] });
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
  return { rerender: render(tree(chat)).rerender, tree };
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
