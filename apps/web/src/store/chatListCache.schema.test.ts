import type { ChatSummary } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import { readChatListCache, writeChatListCache } from './chatListCache';
import type { StorageLike } from './realStore';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('chat list cache schema (T-0508)', () => {
  it('keeps unknown keys on a chat and its lastMessage through a round trip', () => {
    const storage = memoryStorage();
    const chat = {
      id: 'a',
      title: 'a',
      kind: 'dm',
      isAI: false,
      space: 'personal',
      unread: 0,
      muted: false,
      cachedAt: 'kept',
      lastMessage: {
        id: 'm-a',
        chatId: 'a',
        senderId: 'u-1',
        senderName: 'Me',
        text: 'hi a',
        createdAt: new Date(Date.UTC(2026, 8, 28, 12, 0)),
        status: 'sent',
        editedAt: 'kept too',
      },
    } as unknown as ChatSummary;

    writeChatListCache(storage, 'u-1', [chat]);

    const cached = readChatListCache(storage, 'u-1');
    const first = cached?.chats[0] as (ChatSummary & { cachedAt?: string }) | undefined;
    expect(first?.cachedAt).toBe('kept');
    const lastMessage = first?.lastMessage as
      (NonNullable<ChatSummary['lastMessage']> & { editedAt?: string }) | undefined;
    expect(lastMessage?.editedAt).toBe('kept too');
  });
});
