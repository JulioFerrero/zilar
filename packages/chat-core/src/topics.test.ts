import { describe, expect, it } from 'vitest';
import { sortTopics } from './topics';
import type { ChatSummary, TopicInfo } from './types';

function topic(id: string, extra: Partial<ChatSummary> = {}, minutes?: number): ChatSummary {
  return {
    id,
    title: id,
    kind: 'group',
    lastMessage:
      minutes === undefined
        ? undefined
        : {
            id: `m-${id}`,
            chatId: id,
            senderId: 'u',
            senderName: 'U',
            text: id,
            createdAt: new Date(Date.UTC(2026, 8, 28, 0, minutes)),
            status: 'read',
          },
    ...extra,
  } as ChatSummary;
}

const general = topic('general', {
  topic: { isGeneral: true } as TopicInfo,
});

describe('sortTopics', () => {
  it('puts General first, then newest first', () => {
    const rows = sortTopics([topic('old', {}, 1), topic('fresh', {}, 5), general]);
    expect(rows.map((row) => row.id)).toEqual(['general', 'fresh', 'old']);
  });

  it('puts pinned topics above General, newer pins first', () => {
    const rows = sortTopics([
      general,
      topic('pin-old', { pinnedAt: new Date(1000) }, 1),
      topic('plain', {}, 9),
      topic('pin-new', { pinnedAt: new Date(2000) }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['pin-new', 'pin-old', 'general', 'plain']);
  });

  it('breaks ties by title and does not mutate the input', () => {
    const input = [topic('b'), topic('a')];
    expect(sortTopics(input).map((row) => row.id)).toEqual(['a', 'b']);
    expect(input.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
