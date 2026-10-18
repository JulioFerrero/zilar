// T-2027: the shared chat-list cache codec on the message pipeline. The five
// cases the task names, plus the dropped live fields and the owner stamp.
import type { ChatSummary } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';

import { decodeChatListCache, encodeChatListCache } from './chat-list-cache';

const ME = 'u-me';
const ANA = 'ana@zilar.test';

function chat(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title: id,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    pinnedAt: new Date('2026-09-02T09:00:00Z'),
    lastMessage: {
      id: `m-${id}`,
      chatId: id,
      senderId: ANA,
      senderName: 'Ana',
      text: 'hello',
      createdAt: new Date('2026-10-01T09:00:00Z'),
      status: 'sent',
    },
    ...overrides,
  };
}

describe('chat-list cache codec', () => {
  it('round-trips the dates of the row and its last message', () => {
    const decoded = decodeChatListCache(encodeChatListCache(ME, [chat('c1')]), ME);
    expect(decoded?.userId).toBe(ME);
    const [cached] = decoded?.chats ?? [];
    expect(cached?.createdAt).toBeInstanceOf(Date);
    expect(cached?.pinnedAt).toBeInstanceOf(Date);
    expect(cached?.lastMessage?.createdAt).toBeInstanceOf(Date);
    expect(cached?.createdAt?.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(cached?.lastMessage?.createdAt.toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });

  it('does not write the live fields', () => {
    const live: ChatSummary = {
      ...chat('c1'),
      online: true,
      onlineCount: 3,
      lastSeenAt: new Date('2026-10-01T10:00:00Z'),
      aiStatus: 'working',
    };
    const written = JSON.parse(encodeChatListCache(ME, [live])) as {
      chats: Record<string, unknown>[];
    };
    const fields = written.chats[0] ?? {};
    expect(fields).not.toHaveProperty('online');
    expect(fields).not.toHaveProperty('onlineCount');
    expect(fields).not.toHaveProperty('aiStatus');
    expect(fields).not.toHaveProperty('lastSeenAt');
  });

  it('throws on an invalid last-message date, so the storage wrappers can catch it', () => {
    const broken = chat('c1');
    if (broken.lastMessage !== undefined) {
      broken.lastMessage.createdAt = new Date('not a date');
    }
    expect(() => encodeChatListCache(ME, [broken])).toThrow();
  });

  it("returns undefined for another user's cache", () => {
    expect(decodeChatListCache(encodeChatListCache(ME, [chat('c1')]), ANA)).toBeUndefined();
  });

  it('caps the list at 200 chats', () => {
    const chats = Array.from({ length: 205 }, (_, index) => chat(`c${index}`));
    const decoded = decodeChatListCache(encodeChatListCache(ME, chats));
    expect(decoded?.chats).toHaveLength(200);
    expect(decoded?.chats.at(-1)?.id).toBe('c199');
  });

  it('returns undefined for bad JSON', () => {
    expect(decodeChatListCache('{not json')).toBeUndefined();
  });

  it('returns undefined for a wrong version', () => {
    const raw = JSON.stringify({ version: 2, userId: ME, chats: [] });
    expect(decodeChatListCache(raw, ME)).toBeUndefined();
  });
});
