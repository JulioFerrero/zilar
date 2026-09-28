import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@galena/chat-core';
import { renderApp } from '@/test/renderApp';

const chat: ChatSummary = {
  id: 'c-test',
  title: 'Test chat',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function textMessage(text: string): UiMessage {
  return {
    id: 'm1',
    chatId: 'c-test',
    senderId: 'u-bea',
    senderName: 'Bea',
    text,
    createdAt: new Date(2026, 8, 27, 12, 41),
    status: 'read',
  };
}

function render(text: string) {
  return renderApp('/c/c-test', {
    chats: [chat],
    messagesByChat: { 'c-test': [textMessage(text)] },
  });
}

describe('message content', () => {
  it('renders a big-emoji message without a bubble', () => {
    render('😂😂');

    const emoji = screen.getByText('😂😂');
    expect(emoji.closest('[data-bubble-look]')).toBeNull();
  });

  it('links http and https URLs with target and rel', () => {
    render('see https://x.com/a). now');

    const list = screen.getByTestId('message-list');
    const link = within(list).getByRole('link');
    expect(link.textContent).toBe('https://x.com/a');
    expect(link.getAttribute('href')).toBe('https://x.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders an unsafe scheme as plain text', () => {
    render('javascript:alert(1)');

    const list = screen.getByTestId('message-list');
    expect(within(list).queryByRole('link')).toBeNull();
    expect(within(list).getByText('javascript:alert(1)')).toBeTruthy();
  });

  it('shows the full date and time on the bubble time', () => {
    render('hello');

    const list = screen.getByTestId('message-list');
    const time = within(list).getByText('12:41');
    expect(time.getAttribute('title')).toContain('2026');
  });

  it('hides the sender name above a big-emoji message in a group', () => {
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
    renderApp('/c/g1', {
      currentUserId: 'u-you',
      chats: [group],
      messagesByChat: {
        g1: [
          {
            id: 'm1',
            chatId: 'g1',
            senderId: 'u-bea',
            senderName: 'Bea',
            text: '😂😂',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
          },
        ],
      },
    });

    expect(screen.getByText('😂😂')).toBeTruthy();
    expect(screen.queryByText('Bea')).toBeNull();
    // The avatar is still shown.
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('still shows the sender name above a text message in a group', () => {
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
    renderApp('/c/g1', {
      currentUserId: 'u-you',
      chats: [group],
      messagesByChat: {
        g1: [
          {
            id: 'm1',
            chatId: 'g1',
            senderId: 'u-bea',
            senderName: 'Bea',
            text: 'hello',
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
          },
        ],
      },
    });

    expect(screen.getByText('Bea')).toBeTruthy();
    const bubble = screen.getByText('hello').closest('[data-bubble-look]');
    expect(bubble?.getAttribute('data-bubble-look')).toBe('incoming');
  });
});

describe('AI reply Markdown (T-0049)', () => {
  const aiChat: ChatSummary = {
    id: 'c-ai',
    title: 'Dev AI',
    kind: 'ai',
    isAI: true,
    space: 'work',
    unread: 0,
    muted: false,
  };

  function renderAi(text: string, senderId = 'ai-dev-1') {
    return renderApp('/c/c-ai', {
      currentUserId: 'u-you',
      chats: [aiChat],
      messagesByChat: {
        'c-ai': [
          {
            id: 'm1',
            chatId: 'c-ai',
            senderId,
            senderName: senderId === 'u-you' ? 'You' : 'Dev-1',
            text,
            createdAt: new Date(2026, 8, 27, 12, 41),
            status: 'read',
          },
        ],
      },
    });
  }

  it('renders an incoming AI reply as Markdown', () => {
    const { container } = renderAi('**bold** and `code` and [a link](https://x.com)');

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('bold').tagName).toBe('STRONG');
    expect(within(list).getByText('code').tagName).toBe('CODE');
    expect(within(list).getByRole('link').getAttribute('href')).toBe('https://x.com');
    expect(container.querySelector('[data-bubble-look="incoming"]')).not.toBeNull();
  });

  it('keeps Markdown markers literal in a human DM', () => {
    const { container } = render('a **bold** word');

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('a **bold** word')).toBeTruthy();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('keeps Markdown markers literal in your own AI-chat message', () => {
    const { container } = renderAi('a **bold** word', 'u-you');

    expect(screen.getByText('a **bold** word')).toBeTruthy();
    expect(container.querySelector('strong')).toBeNull();
  });
});
