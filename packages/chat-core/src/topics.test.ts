import { describe, expect, it } from 'vitest';
import { chatSortTime, sortTopics } from './topics';
import type { ChatSummary } from './types';

// A row read back from the cache carries its `Date` fields as JSON strings;
// the comparator must tolerate that instead of throwing (T-1479).
function cachedChat(id: string, createdAt: string): ChatSummary {
  return {
    id,
    title: id,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    createdAt,
  } as unknown as ChatSummary;
}

describe('chatSortTime', () => {
  it('sorts a message-less row by a string createdAt without throwing', () => {
    const older = cachedChat('older', '2026-10-01T10:00:00.000Z');
    const newer = cachedChat('newer', '2026-10-02T10:00:00.000Z');

    expect(chatSortTime(older)).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    expect(sortTopics([older, newer]).map((chat) => chat.id)).toEqual(['newer', 'older']);
  });
});
