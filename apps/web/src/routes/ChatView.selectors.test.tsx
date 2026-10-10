import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { ChatView } from './ChatView';

afterEach(cleanup);

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

const message: UiMessage = {
  id: 'm-1',
  chatId: 'c-ana',
  senderId: 'ana',
  senderName: 'Ana',
  text: 'hello there',
  createdAt: new Date('2026-09-28T10:00:00Z'),
  status: 'read',
};

describe('ChatView store selectors (T-0879)', () => {
  it('commits nothing in the chat view for a typing event in another chat', () => {
    const store = createChatStore({ chats: [chat], messagesByChat: { 'c-ana': [message] } });
    const renders = { count: 0 };
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <MemoryRouter>
            <Profiler
              id="view"
              onRender={() => {
                renders.count += 1;
              }}
            >
              <ChatView chat={chat} />
            </Profiler>
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );
    expect(screen.getByText('hello there')).toBeTruthy();
    const before = renders.count;
    act(() => {
      store.setState({ typing: { 'c-other': { names: ['Bo'] } } });
    });
    expect(renders.count).toBe(before);
    expect(screen.getByText('hello there')).toBeTruthy();
  });
});
