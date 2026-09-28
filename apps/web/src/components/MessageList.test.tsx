import { act, render, screen, within } from '@testing-library/react';
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

describe('MessageList AI reply drafts (T-0043)', () => {
  const TURN = 't1';

  function renderWithDraft(seed: ChatStoreSeed, draftText: string) {
    const store = renderMessages(seed);
    act(() => {
      store.setState({ drafts: { 'c-ana': { turnId: TURN, text: draftText } } });
    });
    return store;
  }

  it('renders the draft as the last bubble with trimmed text', () => {
    renderWithDraft({ messagesByChat: { 'c-ana': [hello()] } }, '  writing now  ');

    expect(screen.getByText('writing now')).toBeTruthy();
    const bubbles = document.querySelectorAll('[data-message-id]');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]?.getAttribute('data-message-id')).toBe(`draft-${TURN}`);
  });

  it('keeps exactly one bubble with the same text when the final message arrives', () => {
    const store = renderWithDraft({ messagesByChat: { 'c-ana': [] } }, 'hello there');

    expect(screen.getAllByText('hello there')).toHaveLength(1);
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(1);

    act(() => {
      store.setState({ messagesByChat: { 'c-ana': [hello()] }, drafts: {} });
    });

    expect(screen.getAllByText('hello there')).toHaveLength(1);
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(1);
  });

  it('shows no second typing indicator in the list while a draft is shown', () => {
    const store = renderWithDraft({ messagesByChat: { 'c-ana': [hello()] } }, 'writing now');
    act(() => {
      store.setState({ typing: { 'c-ana': { names: ['Ana'] } } });
    });

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('writing now')).toBeTruthy();
    expect(within(list).queryByText(/typing/i)).toBeNull();
  });

  it('does not pull the view down when a draft grows while scrolled up', () => {
    const store = renderWithDraft({ messagesByChat: { 'c-ana': [hello()] } }, 'first');

    const list = screen.getByTestId('message-list');
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 100, writable: true, configurable: true });

    // The scroll listener sees a large distance from the bottom: not at bottom.
    fireEvent.scroll(list);

    act(() => {
      store.setState({ drafts: { 'c-ana': { turnId: TURN, text: 'first, then much more text' } } });
    });

    expect(list.scrollTop).toBe(100);
  });
});
