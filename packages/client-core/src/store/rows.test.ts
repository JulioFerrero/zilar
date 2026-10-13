// The shared chat-row helpers (UI-12): a row discovered by a refresh is
// ordered by recency with the rows already known, so a row that has no preview
// yet does not jump to the top and sink again on the next tick.
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import { orderChatRows, sortByRecency } from './rows';

function row(id: string, title: string, lastMessage?: UiMessage, createdAt?: string): ChatSummary {
  return {
    id,
    kind: 'dm',
    title,
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...(lastMessage === undefined ? {} : { lastMessage }),
    ...(createdAt === undefined ? {} : { createdAt: new Date(createdAt) }),
  } as ChatSummary;
}

function preview(id: string, chatId: string, at: string): UiMessage {
  return {
    id,
    chatId,
    senderId: 'ana@zilar.test',
    senderName: 'Ana',
    text: 'hello',
    createdAt: new Date(at),
    status: 'sent',
  };
}

describe('orderChatRows', () => {
  it('places a new row with no preview by recency instead of on top (UI-12)', () => {
    const older = row(
      'a@zilar.test',
      'Ana',
      preview('a-1', 'a@zilar.test', '2026-10-01T10:00:00Z'),
    );
    const newer = row('b@zilar.test', 'Bo', preview('b-1', 'b@zilar.test', '2026-10-02T10:00:00Z'));
    const fresh = row('c@zilar.test', 'Cy');

    const ordered = orderChatRows([fresh], [older, newer]);

    // A missing preview counts as the oldest, so the new row sinks instead of
    // leading the list for one tick.
    expect(ordered.map((chat) => chat.id)).toEqual([
      'b@zilar.test',
      'a@zilar.test',
      'c@zilar.test',
    ]);
  });
});

// T-1318: a chat with no messages sorts by when it was created/joined, so a
// just-created group (which nobody has posted in yet) leads the list like
// Telegram instead of sinking to the bottom. A chat that has messages is never
// moved by its creation time.
describe('sortByRecency with a chat that has no messages', () => {
  it('sorts a newer empty chat above an older chat that has messages', () => {
    const olderWithMessages = row(
      'a@zilar.test',
      'Ana',
      preview('a-1', 'a@zilar.test', '2026-10-01T10:00:00Z'),
    );
    const newEmpty = row('night@zilar.test', 'NightQA', undefined, '2026-10-03T10:00:00Z');

    const ordered = sortByRecency([olderWithMessages, newEmpty]);

    expect(ordered.map((chat) => chat.id)).toEqual(['night@zilar.test', 'a@zilar.test']);
  });

  it('keeps the order when neither chat has a message or a creation time', () => {
    const a = row('a@zilar.test', 'Ana');
    const b = row('b@zilar.test', 'Bo');

    // Both count as the oldest, so the tie is broken by title, like before.
    expect(sortByRecency([b, a]).map((chat) => chat.id)).toEqual(['a@zilar.test', 'b@zilar.test']);
  });
});
