import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

const aiChat: ChatSummary = {
  id: 'c-devai',
  title: 'Dev AI',
  kind: 'ai',
  isAI: true,
  space: 'work',
  unread: 0,
  muted: false,
};

const personChat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

// T-0164: a public group carries `visibility: 'public'` on its row (from
// the chat list entry), like the CHANNEL tag for channels.
const publicGroup: ChatSummary = {
  id: 'c-hiking',
  title: 'Hiking club',
  kind: 'group',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
  memberCount: 12,
  visibility: 'public',
  handle: 'hiking_club',
  // T-0165: the group's picture rides the row.
  avatarUrl: '/api/avatars/g-hiking',
};

describe('ChatListItem', () => {
  it('shows writing… while a draft exists for an AI chat', () => {
    const { store } = renderApp('/', { chats: [aiChat], messagesByChat: {} });

    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      store.setState({ drafts: { 'c-devai': { turnId: 't-1', text: 'hello' } } });
    });

    expect(screen.getByText('writing…')).toBeTruthy();
  });

  it('shows typing… while a person types', () => {
    const { store } = renderApp('/', { chats: [personChat], messagesByChat: {} });

    act(() => {
      store.setState({ typing: { 'c-ana': { names: ['Ana'] } } });
    });

    expect(screen.getByText('typing…')).toBeTruthy();
    expect(screen.queryByText('writing…')).toBeNull();
  });

  it('shows a plain preview for a Markdown AI reply', () => {
    renderApp('/', {
      chats: [
        {
          ...aiChat,
          lastMessage: {
            id: 'm-1',
            chatId: 'c-devai',
            senderId: 'ai-dev-1',
            senderName: 'Dev-1',
            text: '**Deployed** to `staging`',
            createdAt: new Date(2026, 8, 28, 10, 0),
            status: 'read',
          },
        },
      ],
      messagesByChat: {},
    });

    expect(screen.getByText('Deployed to staging')).toBeTruthy();
    expect(screen.queryByText('**Deployed** to `staging`')).toBeNull();
  });

  it('keeps literal markers in a human chat preview', () => {
    renderApp('/', {
      chats: [
        {
          ...personChat,
          lastMessage: {
            id: 'm-2',
            chatId: 'c-ana',
            senderId: 'u-ana',
            senderName: 'Ana',
            text: 'a **bold** word',
            createdAt: new Date(2026, 8, 28, 10, 0),
            status: 'read',
          },
        },
      ],
      messagesByChat: {},
    });

    expect(screen.getByText('a **bold** word')).toBeTruthy();
  });

  it('keeps literal markers in your own AI-chat preview', () => {
    renderApp('/', {
      chats: [
        {
          ...aiChat,
          lastMessage: {
            id: 'm-3',
            chatId: 'c-devai',
            senderId: 'u-you',
            senderName: 'You',
            text: 'a **bold** word',
            createdAt: new Date(2026, 8, 28, 10, 0),
            status: 'sent',
          },
        },
      ],
      messagesByChat: {},
    });

    expect(screen.getByText('a **bold** word')).toBeTruthy();
    expect(screen.queryByText('a bold word')).toBeNull();
  });

  it('shows a plain preview for a Markdown AI reply in a group', () => {
    renderApp('/', {
      chats: [
        {
          id: 'g-dev',
          title: 'Dev team',
          kind: 'group',
          isAI: false,
          space: 'work',
          unread: 0,
          muted: false,
          lastMessage: {
            id: 'm-4',
            chatId: 'g-dev',
            senderId: 'ai-dev-1@zilar.test',
            senderName: 'Dev-1',
            text: '**Deployed** to `staging`',
            createdAt: new Date(2026, 8, 28, 10, 0),
            status: 'read',
          },
        },
      ],
      messagesByChat: {},
    });

    expect(screen.getByText('Deployed to staging')).toBeTruthy();
    expect(screen.queryByText('**Deployed** to `staging`')).toBeNull();
  });

  it('keeps literal markers in a human group message preview', () => {
    renderApp('/', {
      chats: [
        {
          id: 'g-fam',
          title: 'Familia',
          kind: 'group',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
          lastMessage: {
            id: 'm-5',
            chatId: 'g-fam',
            senderId: 'u-ana@zilar.test',
            senderName: 'Ana',
            text: 'a **bold** word',
            createdAt: new Date(2026, 8, 28, 10, 0),
            status: 'read',
          },
        },
      ],
      messagesByChat: {},
    });

    expect(screen.getByText('a **bold** word')).toBeTruthy();
  });

  it('shows a PUBLIC tag on public groups, and none on private ones', () => {
    renderApp('/', { chats: [publicGroup, personChat], messagesByChat: {} });

    expect(screen.getByText('PUBLIC')).toBeTruthy();
    expect(screen.queryByText('CHANNEL')).toBeNull();
  });

  it('shows the group picture when the row carries one (T-0165)', () => {
    const { container } = renderApp('/', { chats: [publicGroup], messagesByChat: {} });
    expect(container.querySelector('img[src="/api/avatars/g-hiking"]')).not.toBeNull();
  });

  it('falls back to initials when the row carries no picture (T-0165)', () => {
    const { container } = renderApp('/', { chats: [personChat], messagesByChat: {} });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('A');
  });
});
