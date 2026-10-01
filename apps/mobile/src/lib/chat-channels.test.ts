import { describe, expect, it } from 'vitest';

import type { ChatSummary } from './types';
import { chatSubtitle } from './chat';

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'x',
    title: 'X',
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

describe('chatSubtitle channels (T-0144)', () => {
  it('reads "N subscribers" for a channel', () => {
    expect(
      chatSubtitle(chat({ chatKind: 'channel', subscriberCount: 4, memberCount: 4 }), new Date()),
    ).toBe('4 subscribers');
    expect(chatSubtitle(chat({ chatKind: 'channel', subscriberCount: 1 }), new Date())).toBe(
      '1 subscriber',
    );
  });

  it('falls back to the member count when the subscriber count is absent', () => {
    expect(chatSubtitle(chat({ chatKind: 'channel', memberCount: 6 }), new Date())).toBe(
      '6 subscribers',
    );
  });

  it('keeps groups reading "N members"', () => {
    expect(chatSubtitle(chat({ memberCount: 6, onlineCount: 2 }), new Date())).toBe(
      '6 members, 2 online',
    );
  });
});
