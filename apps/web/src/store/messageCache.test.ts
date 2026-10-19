import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import { buildCacheSnapshot } from '@zilar/client-core/store';
import {
  MAX_CACHED_CHATS,
  MESSAGE_CACHE_KEY,
  clearMessageCache,
  createWebMessageCache,
  readMessageCache,
} from './messageCache';
import type { StorageLike } from './effects/portTypes';

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

function message(chatId: string, id: string, overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id,
    chatId,
    senderId: 'u-ana',
    senderName: 'Ana',
    text: id,
    createdAt: new Date('2026-10-17T10:00:00.000Z'),
    status: 'sent',
    ...overrides,
  };
}

function chat(id: string): ChatSummary {
  return { id } as ChatSummary;
}

async function writeCache(
  storage: StorageLike,
  userId: string,
  chats: readonly ChatSummary[],
  messagesByChat: Record<string, UiMessage[]>,
): Promise<void> {
  const snapshot = buildCacheSnapshot({
    userId,
    chats,
    messagesByChat,
    activeChatId: null,
    maxChats: MAX_CACHED_CHATS,
  });
  if (snapshot === undefined) {
    return;
  }
  const cache = createWebMessageCache(storage);
  cache.schedule(snapshot);
  cache.flush();
  // The shared writer queues the port write on a promise chain.
  await Promise.resolve();
}

describe('message cache (T-1903)', () => {
  it('round-trips one user and gives another user nothing', async () => {
    const storage = memoryStorage();
    const ana = 'ana@zilar.test';
    const bob = 'bob@zilar.test';

    await writeCache(storage, 'u-1', [chat(ana), chat(bob)], {
      [ana]: [message(ana, 'm1'), message(ana, 'm2')],
      [bob]: [message(bob, 'm3')],
    });

    const cached = readMessageCache(storage, 'u-1');
    expect(Object.keys(cached)).toEqual([ana, bob]);
    expect(cached[ana]?.map((entry) => entry.id)).toEqual(['m1', 'm2']);
    expect(cached[ana]?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(cached[ana]?.[0]?.createdAt.toISOString()).toBe('2026-10-17T10:00:00.000Z');

    // Another account reads nothing, and the foreign copy is dropped.
    expect(readMessageCache(storage, 'u-2')).toEqual({});
    expect(storage.getItem(MESSAGE_CACHE_KEY)).toBeNull();

    // Sign-out drops the key too.
    await writeCache(storage, 'u-1', [chat(ana)], { [ana]: [message(ana, 'm1')] });
    clearMessageCache(storage);
    expect(storage.getItem(MESSAGE_CACHE_KEY)).toBeNull();
  });
});
