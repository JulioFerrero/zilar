import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ForwardOrigin } from '@zilar/protocol';
import { AuthProvider } from '@/auth/AuthProvider';
import { listBlockedUsers } from '@/lib/api';
import { resetBlockedJidsForTests } from '@/lib/blockedJids';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
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

function forwarded(forward?: ForwardOrigin): UiMessage {
  return {
    id: 'm-forward',
    chatId: 'c-ana',
    senderId: 'ana',
    senderName: 'Ana',
    text: 'hello there',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    status: 'read',
    ...(forward === undefined ? {} : { forward }),
  };
}

function renderMessages(seed: ChatStoreSeed) {
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
        <MessageList chat={chat} onReply={() => {}} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return store;
}

describe('MessageBubble forwarded header (T-0409)', () => {
  it('shows the original sender name', () => {
    renderMessages({
      messagesByChat: {
        'c-ana': [
          forwarded({
            sender_id: 'luis@zilar.test',
            sender_name: 'Luis',
            original_at: '2026-08-30T18:00:00.000Z',
          }),
        ],
      },
    });

    expect(screen.getByText('Forwarded from Luis')).toBeTruthy();
  });

  it('adds the origin chat name only when the origin is public', () => {
    renderMessages({
      messagesByChat: {
        'c-ana': [
          forwarded({
            sender_id: 'luis@zilar.test',
            sender_name: 'Luis',
            chat_id: 'c-viernes@conference.zilar.test',
            chat_name: 'Friday plans',
            original_at: '2026-08-30T18:00:00.000Z',
          }),
        ],
      },
    });

    expect(screen.getByText('Forwarded from Luis in Friday plans')).toBeTruthy();
  });

  it('shows no header on a message without a forward', () => {
    renderMessages({ messagesByChat: { 'c-ana': [forwarded()] } });

    expect(screen.queryByText(/Forwarded from/)).toBeNull();
  });
});
