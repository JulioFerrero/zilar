import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
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
    // The AI's own message: same sender as the draft (ChatSummary.id), the
    // way production renders the AI's bare JID.
    senderId: 'c-ana',
    senderName: 'Ana',
    text: 'hello there',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    status: 'read',
  };
}

function renderMessages(seed: ChatStoreSeed, activeChat: ChatSummary = chat) {
  const store = createChatStore(seed);
  render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <MessageList chat={activeChat} onReply={() => {}} />
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

    const bubbleBefore = document.querySelector('[data-message-id]');
    expect(screen.getAllByText('hello there')).toHaveLength(1);
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(1);

    act(() => {
      store.setState({ messagesByChat: { 'c-ana': [hello()] }, drafts: {} });
    });

    const bubbleAfter = document.querySelector('[data-message-id]');
    expect(screen.getAllByText('hello there')).toHaveLength(1);
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(1);
    // The final message groups exactly like the draft did, so the bubble keeps
    // the same position/size instead of moving.
    expect(bubbleAfter?.className).toBe(bubbleBefore?.className);
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

  function reply(text: string): UiMessage {
    return { ...hello(), text };
  }

  function stubReducedMotion(reduce: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  it('gives the draft bubble the generating look and a caret', () => {
    renderWithDraft({ messagesByChat: { 'c-ana': [hello()] } }, 'writing now');

    const draftBubble = document.querySelector('[data-draft-turn="t1"]');
    expect(draftBubble).not.toBeNull();
    expect(within(draftBubble as HTMLElement).getByText('writing now')).toBeTruthy();
    expect(draftBubble?.querySelector('[data-bubble-look="generating"]')).not.toBeNull();
    expect(draftBubble?.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('keeps the same bubble revealing after the final message replaces the draft', async () => {
    const store = renderWithDraft({ messagesByChat: { 'c-ana': [] } }, 'Hello');
    const before = document.querySelector('[data-draft-turn="t1"]');
    expect(before).not.toBeNull();
    expect(before?.querySelector('.animate-pulse')).not.toBeNull();

    act(() => {
      store.setState({
        messagesByChat: { 'c-ana': [reply('Hello there')] },
        drafts: {},
        finishedDraftMessages: { 'm-1': TURN },
      });
    });

    // The same DOM node: the final message kept the draft's key.
    const after = document.querySelector('[data-draft-turn="t1"]');
    expect(after).toBe(before);
    // Still revealing from where the draft was, still in the generating look.
    expect(within(after as HTMLElement).getByText('Hello')).toBeTruthy();
    expect(within(after as HTMLElement).queryByText('Hello there')).toBeNull();
    expect(after?.querySelector('[data-bubble-look="generating"]')).not.toBeNull();
    expect(after?.querySelector('.animate-pulse')).not.toBeNull();

    expect(await within(after as HTMLElement).findByText('Hello there')).toBeTruthy();
    expect(after?.querySelector('.animate-pulse')).toBeNull();
    expect(after?.querySelector('[data-bubble-look="generating"]')).toBeNull();
    expect(document.querySelector('[data-draft-turn="t1"]')).toBe(before);
  });

  it('never gives a message loaded from history the generating look', () => {
    renderMessages({ messagesByChat: { 'c-ana': [hello()] } });

    const bubble = document.querySelector('[data-message-id="m-1"]');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('[data-bubble-look="generating"]')).toBeNull();
    expect(bubble?.querySelector('.animate-pulse')).toBeNull();
    expect(document.querySelector('[data-draft-turn]')).toBeNull();
  });

  it('shows the final text at once with reduced motion', () => {
    stubReducedMotion(true);
    try {
      const store = renderWithDraft({ messagesByChat: { 'c-ana': [] } }, 'Hello');
      act(() => {
        store.setState({
          messagesByChat: { 'c-ana': [reply('Hello there')] },
          drafts: {},
          finishedDraftMessages: { 'm-1': TURN },
        });
      });

      const bubble = document.querySelector('[data-draft-turn="t1"]');
      expect(within(bubble as HTMLElement).getByText('Hello there')).toBeTruthy();
      expect(bubble?.querySelector('.animate-pulse')).toBeNull();
      expect(bubble?.querySelector('[data-bubble-look="generating"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('MessageBubble looks (T-0047)', () => {
  function message(senderId: string, senderName: string, minute: number): UiMessage {
    return {
      id: `m-${minute}`,
      chatId: 'c-ana',
      senderId,
      senderName,
      text: `message ${minute}`,
      createdAt: new Date(2026, 8, 28, 10, minute),
      status: 'read',
    };
  }

  it('gives outgoing and incoming bubbles their look', () => {
    renderMessages({
      currentUserId: 'u-you',
      messagesByChat: { 'c-ana': [message('c-ana', 'Ana', 1), message('u-you', 'You', 2)] },
    });

    expect(document.querySelector('[data-bubble-look="incoming"]')).not.toBeNull();
    expect(document.querySelector('[data-bubble-look="outgoing"]')).not.toBeNull();
  });

  it('gives a live draft the generating look', () => {
    const store = renderMessages({
      currentUserId: 'u-you',
      messagesByChat: { 'c-ana': [message('c-ana', 'Ana', 1)] },
    });
    act(() => {
      store.setState({ drafts: { 'c-ana': { turnId: 't-look', text: 'writing' } } });
    });

    const draft = document.querySelector('[data-draft-turn="t-look"]');
    expect(draft?.querySelector('[data-bubble-look="generating"]')).not.toBeNull();
  });
});

describe('MessageBubble grouping (T-0047)', () => {
  const group: ChatSummary = {
    id: 'g1',
    title: 'Team',
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: 3,
  };

  function groupMessage(
    id: string,
    senderId: string,
    senderName: string,
    minute: number,
  ): UiMessage {
    return {
      id,
      chatId: 'g1',
      senderId,
      senderName,
      text: `${senderName} ${minute}`,
      createdAt: new Date(2026, 8, 28, 10, minute),
      status: 'read',
    };
  }

  it('shows sender names once per group and the tail only on the last bubble', () => {
    renderMessages(
      {
        currentUserId: 'u-you',
        messagesByChat: {
          g1: [
            groupMessage('m1', 'u-bea', 'Bea', 1),
            groupMessage('m2', 'u-bea', 'Bea', 2),
            groupMessage('m3', 'u-carlos', 'Carlos', 3),
          ],
        },
      },
      group,
    );

    expect(screen.getAllByText('Bea')).toHaveLength(1);
    expect(screen.getAllByText('Carlos')).toHaveLength(1);

    const bubbleOf = (id: string): Element | null | undefined =>
      document.querySelector(`[data-message-id="${id}"]`)?.querySelector('[data-bubble-look]');

    expect(bubbleOf('m1')?.classList.contains('rounded-bl-[4px]')).toBe(false);
    expect(bubbleOf('m2')?.classList.contains('rounded-bl-[4px]')).toBe(true);
    expect(bubbleOf('m3')?.classList.contains('rounded-bl-[4px]')).toBe(true);
  });
});

describe('MessageList Markdown drafts (T-0049)', () => {
  const aiChat: ChatSummary = {
    id: 'c-ai',
    title: 'Dev AI',
    kind: 'ai',
    isAI: true,
    space: 'work',
    unread: 0,
    muted: false,
  };

  it('keeps the same bubble when a Markdown draft becomes the final message', async () => {
    const store = renderMessages({ messagesByChat: { 'c-ai': [] } }, aiChat);
    act(() => {
      store.setState({ drafts: { 'c-ai': { turnId: 'tm', text: '**Hello**' } } });
    });

    const before = document.querySelector('[data-draft-turn="tm"]');
    expect(before).not.toBeNull();
    expect(before?.querySelector('strong')?.textContent).toBe('Hello');
    expect(before?.querySelector('[data-bubble-look="generating"]')).not.toBeNull();

    act(() => {
      store.setState({
        messagesByChat: {
          'c-ai': [
            {
              id: 'm-md',
              chatId: 'c-ai',
              senderId: 'ai-dev-1',
              senderName: 'Dev-1',
              text: '**Hello there**',
              createdAt: new Date('2026-09-28T10:00:00Z'),
              status: 'read',
            },
          ],
        },
        drafts: {},
        finishedDraftMessages: { 'm-md': 'tm' },
      });
    });

    // The same DOM node: the final message kept the draft's key, and it keeps
    // revealing the Markdown in the generating look.
    const after = document.querySelector('[data-draft-turn="tm"]');
    expect(after).toBe(before);
    expect(after?.querySelector('[data-bubble-look="generating"]')).not.toBeNull();
    await waitFor(() => {
      expect(after?.querySelector('strong')?.textContent).toBe('Hello there');
    });
    expect(after?.querySelector('[data-bubble-look="generating"]')).toBeNull();
  });
});
