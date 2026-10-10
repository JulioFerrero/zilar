import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { listBlockedUsers } from '@/lib/api';
import { resetBlockedJidsForTests } from '@/lib/blockedJids';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { ChatListItem } from './ChatListItem';
import { MessageBubble } from './MessageBubble';
import { MessageList } from './MessageList';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    listBlockedUsers: vi.fn(async () => []),
  };
});

beforeEach(() => {
  resetBlockedJidsForTests();
  vi.mocked(listBlockedUsers).mockReset();
  vi.mocked(listBlockedUsers).mockResolvedValue([]);
  cleanup();
});

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

function setup(seed: ChatStoreSeed, build: (onRender: () => void) => ReactNode) {
  const store = createChatStore(seed);
  const renders = { count: 0 };
  const onRender = (): void => {
    renders.count += 1;
  };
  render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <MemoryRouter>{build(onRender)}</MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, renders };
}

const seed: ChatStoreSeed = { chats: [chat], messagesByChat: { 'c-ana': [message] } };

describe('store selectors (T-0845)', () => {
  it('does not re-render a MessageBubble for a typing event in another chat', () => {
    const { store, renders } = setup(seed, (onRender) => (
      <Profiler id="bubble" onRender={onRender}>
        <MessageBubble
          message={message}
          chat={chat}
          firstInGroup
          lastInGroup
          currentUserId="u-you"
          onReply={() => {}}
        />
      </Profiler>
    ));
    expect(screen.getByText('hello there')).toBeTruthy();
    const before = renders.count;
    act(() => {
      store.setState({ typing: { 'c-other': { names: ['Bo'] } } });
    });
    expect(renders.count).toBe(before);
    expect(screen.getByText('hello there')).toBeTruthy();
  });

  it('does not re-render a MessageList for a typing event in another chat', () => {
    const { store, renders } = setup(seed, (onRender) => (
      <Profiler id="list" onRender={onRender}>
        <MessageList chat={chat} onReply={() => {}} />
      </Profiler>
    ));
    expect(screen.getByText('hello there')).toBeTruthy();
    const before = renders.count;
    act(() => {
      store.setState({ typing: { 'c-other': { names: ['Bo'] } } });
    });
    expect(renders.count).toBe(before);
  });

  it('re-renders a ChatListItem only for its own chat', () => {
    const { store, renders } = setup(seed, (onRender) => (
      <Profiler id="row" onRender={onRender}>
        <ChatListItem chat={chat} selected={false} />
      </Profiler>
    ));
    expect(screen.getByText('Ana')).toBeTruthy();
    const before = renders.count;
    act(() => {
      store.setState({ typing: { 'c-other': { names: ['Bo'] } } });
    });
    expect(renders.count).toBe(before);
    act(() => {
      store.setState({ typing: { 'c-ana': { names: ['Ana'] } } });
    });
    expect(renders.count).toBeGreaterThan(before);
    expect(screen.getByText('typing…')).toBeTruthy();
  });
});
