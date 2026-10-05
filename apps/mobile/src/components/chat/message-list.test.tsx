import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';

import { filterBlockedMessages } from '@/lib/blocked-users';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

function message(id: string, senderId: string): UiMessage {
  return {
    id,
    chatId: 'g1',
    senderId,
    senderName: senderId,
    text: `message ${id}`,
    createdAt: new Date(2026, 8, 28, 10, 0),
    status: 'read',
  };
}

const group: ChatSummary = {
  id: 'g1',
  title: 'Team',
  kind: 'group',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

describe('filterBlockedMessages', () => {
  it('drops a blocked sender in a group and keeps the rest', () => {
    const messages = [
      message('m1', 'carlos@zilar.test'),
      message('m2', 'bea@zilar.test'),
      message('m3', 'u-you'),
    ];
    expect(
      filterBlockedMessages(group, messages, new Set(['bea']), 'u-you').map((item) => item.id),
    ).toEqual(['m1', 'm3']);
  });

  it('keeps my own messages even when my localpart is blocked', () => {
    const mine = message('m1', 'bea@zilar.test');
    expect(filterBlockedMessages(group, [mine], new Set(['bea']), 'bea@zilar.test')).toEqual([
      mine,
    ]);
  });

  it('leaves a DM untouched', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    const chat: ChatSummary = { ...group, kind: 'dm' };
    expect(filterBlockedMessages(chat, messages, new Set(['bea']), 'u-you')).toBe(messages);
  });

  it('leaves an AI group untouched', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    const chat: ChatSummary = { ...group, isAI: true, kind: 'ai' };
    expect(filterBlockedMessages(chat, messages, new Set(['bea']), 'u-you')).toBe(messages);
  });

  it('does not copy the list when nobody is blocked', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    expect(filterBlockedMessages(group, messages, new Set(), 'u-you')).toBe(messages);
  });
});
