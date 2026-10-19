import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CACHE_KEY,
  clearMessageCache,
  readMessageCache,
  writeMessageCache,
} from './messageCache';
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

describe('message cache (T-1903)', () => {
  it('round-trips one user and gives another user nothing', () => {
    const storage = memoryStorage();
    const ana = 'ana@zilar.test';
    const bob = 'bob@zilar.test';

    writeMessageCache(storage, 'u-1', [chat(ana), chat(bob)], {
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
    writeMessageCache(storage, 'u-1', [chat(ana)], { [ana]: [message(ana, 'm1')] });
    clearMessageCache(storage);
    expect(storage.getItem(MESSAGE_CACHE_KEY)).toBeNull();
  });
});
