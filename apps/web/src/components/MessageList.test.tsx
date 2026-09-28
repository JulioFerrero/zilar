import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@galena/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { MessageList } from './MessageList';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
  online: true,
};

function hello(): UiMessage {
  return {
    id: 'm-1',
    chatId: 'c-ana',
    senderId: 'u-ana',
    senderName: 'Ana',
    text: 'hello there',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    status: 'read',
  };
}

function renderMessages(seed: ChatStoreSeed) {
  const store = createChatStore(seed);
  render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <MessageList chat={chat} onReply={() => {}} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return store;
}

describe('MessageList loading states', () => {
  it('shows loading first, then the messages', async () => {
    const store = renderMessages({
      historyState: { 'c-ana': 'loading' },
      messagesByChat: { 'c-ana': [] },
    });

    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();

    store.setState({
      historyState: { 'c-ana': 'ready' },
      messagesByChat: { 'c-ana': [hello()] },
    });

    expect(await screen.findByText('hello there')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading messages' })).toBeNull();
  });

  it('shows the empty state only after an empty load', async () => {
    const store = renderMessages({
      historyState: { 'c-ana': 'loading' },
      messagesByChat: { 'c-ana': [] },
    });
    expect(screen.queryByText('No messages yet')).toBeNull();

    store.setState({ historyState: { 'c-ana': 'ready' } });
    expect(await screen.findByText('No messages yet')).toBeTruthy();
  });

  it('shows an error with Retry when history fails to load', () => {
    const store = renderMessages({
      historyState: { 'c-ana': 'error' },
      messagesByChat: { 'c-ana': [] },
    });

    expect(screen.getByText("Couldn't load messages")).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    const onRetry = vi.fn();
    store.setState({ retryHistory: onRetry });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith('c-ana');
  });

  it('keeps live messages visible while a reload is in flight', () => {
    renderMessages({
      historyState: { 'c-ana': 'loading' },
      messagesByChat: { 'c-ana': [hello()] },
    });

    expect(screen.getByText('hello there')).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
});
