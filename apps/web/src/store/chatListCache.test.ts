import type { ChatSummary } from '@galena/chat-core';
import { describe, expect, it } from 'vitest';
import {
  CHAT_LIST_CACHE_KEY,
  clearChatListCache,
  readChatListCache,
  writeChatListCache,
} from './chatListCache';
import { mergeWithPainted, type StorageLike } from './realStore';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function chat(id: string, minutesAgo?: number): ChatSummary {
  const summary: ChatSummary = {
    id,
    title: id,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
  };
  if (minutesAgo !== undefined) {
    summary.lastMessage = {
      id: `m-${id}`,
      chatId: id,
      senderId: 'u-1',
      senderName: 'Me',
      text: `hi ${id}`,
      createdAt: new Date(Date.UTC(2026, 8, 28, 12, 0) - minutesAgo * 60_000),
      status: 'sent',
    };
  }
  return summary;
}

describe('chat list cache', () => {
  it('round-trips order, previews and dates for the same user', () => {
    const storage = memoryStorage();
    writeChatListCache(storage, 'u-1', [chat('b', 1), chat('a', 5), chat('c')]);

    const cached = readChatListCache(storage, 'u-1');
    expect(cached?.chats.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    expect(cached?.chats[0]?.lastMessage?.text).toBe('hi b');
    expect(cached?.chats[0]?.lastMessage?.createdAt).toBeInstanceOf(Date);
    expect(cached?.chats[2]?.lastMessage).toBeUndefined();
  });

  it("never returns another user's list", () => {
    const storage = memoryStorage();
    writeChatListCache(storage, 'u-1', [chat('a', 1)]);
    expect(readChatListCache(storage, 'u-2')).toBeNull();
  });

  it('never caches live presence', () => {
    const storage = memoryStorage();
    writeChatListCache(storage, 'u-1', [{ ...chat('a', 1), online: true, onlineCount: 3 }]);
    const cached = readChatListCache(storage, 'u-1');
    expect(cached?.chats[0]?.online).toBeUndefined();
    expect(cached?.chats[0]?.onlineCount).toBeUndefined();
  });

  it('ignores a corrupt or foreign-shaped cache', () => {
    const storage = memoryStorage();
    storage.setItem(CHAT_LIST_CACHE_KEY, '{not json');
    expect(readChatListCache(storage)).toBeNull();
    storage.setItem(CHAT_LIST_CACHE_KEY, JSON.stringify({ version: 99, chats: [] }));
    expect(readChatListCache(storage)).toBeNull();
  });

  it('is removed on clear', () => {
    const storage = memoryStorage();
    writeChatListCache(storage, 'u-1', [chat('a', 1)]);
    clearChatListCache(storage);
    expect(storage.data.has(CHAT_LIST_CACHE_KEY)).toBe(false);
  });
});

describe('mergeWithPainted', () => {
  it('keeps painted previews and recency order when fresh entries arrive without them', () => {
    const painted = [chat('b', 1), chat('a', 5)];
    const fresh = [chat('a'), chat('b'), chat('new')];

    const merged = mergeWithPainted(painted, fresh, true);
    expect(merged.map((entry) => entry.id)).toEqual(['b', 'a', 'new']);
    expect(merged[0]?.lastMessage?.text).toBe('hi b');
  });

  it('drops chats the server no longer lists', () => {
    const merged = mergeWithPainted([chat('gone', 1), chat('a', 2)], [chat('a')], true);
    expect(merged.map((entry) => entry.id)).toEqual(['a']);
  });

  it("uses only fresh data when the painted list was another user's", () => {
    const fresh = [chat('x')];
    expect(mergeWithPainted([chat('a', 1)], fresh, false)).toBe(fresh);
  });
});
