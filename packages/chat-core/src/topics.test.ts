import { describe, expect, it } from 'vitest';
import { writingLabel } from './chat-labels';
import { chatSortTime, inTopic, sortTopics } from './topics';
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

describe('inTopic', () => {
  const topic = { isGeneral: false, memberIds: ['u-ana'], ais: [{ id: 'ai-dev-1' }] };

  it('is true for General, whichever entity', () => {
    expect(inTopic({ isGeneral: true }, { kind: 'person', id: 'u-luis' })).toBe(true);
    expect(inTopic({ isGeneral: true }, { kind: 'ai', id: 'ai-qa-1' })).toBe(true);
  });

  it('is true for a listed person and a listed AI', () => {
    expect(inTopic(topic, { kind: 'person', id: 'u-ana' })).toBe(true);
    expect(inTopic(topic, { kind: 'ai', id: 'ai-dev-1' })).toBe(true);
  });

  it('is false for a group person or group AI who is not listed', () => {
    expect(inTopic(topic, { kind: 'person', id: 'u-luis' })).toBe(false);
    expect(inTopic(topic, { kind: 'ai', id: 'ai-qa-1' })).toBe(false);
  });
});

describe('writingLabel', () => {
  it('covers one, two and three or more writers', () => {
    expect(writingLabel(['Deepseek'])).toBe('Deepseek is writing…');
    expect(writingLabel(['Julio Perez', 'Deepseek'])).toBe('Julio, Deepseek writing…');
    expect(writingLabel(['Ana', 'Luis', 'Deepseek'])).toBe('3 writing…');
  });

  it('is undefined when nobody writes', () => {
    expect(writingLabel([])).toBeUndefined();
  });
});
