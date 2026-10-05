import { describe, expect, it } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { previewMessage } from './preview-message';

function message(id: string, senderId: string, minute: number): UiMessage {
  return {
    id,
    chatId: 'g1',
    senderId,
    senderName: senderId,
    text: `message ${id}`,
    createdAt: new Date(2026, 8, 28, 10, minute),
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

const blocked = new Set(['bea']);

describe('previewMessage', () => {
  it('previews the last message when its sender is not blocked', () => {
    const last = message('m2', 'carlos@zilar.test', 2);
    const chat = { ...group, lastMessage: last };
    const messages = [message('m1', 'bea@zilar.test', 1), last];
    expect(previewMessage(chat, messages, blocked, 'u-you')).toBe(last);
  });

  it('falls back to the newest visible message when the last is blocked', () => {
    const blockedLast = message('m3', 'bea@zilar.test', 3);
    const chat = { ...group, lastMessage: blockedLast };
    const messages = [
      message('m1', 'carlos@zilar.test', 1),
      message('m2', 'bea@zilar.test', 2),
      blockedLast,
    ];
    expect(previewMessage(chat, messages, blocked, 'u-you')?.id).toBe('m1');
  });

  it('keeps my own messages when the last is blocked', () => {
    const blockedLast = message('m2', 'bea@zilar.test', 2);
    const chat = { ...group, lastMessage: blockedLast };
    const mine = message('m1', 'u-you', 1);
    expect(previewMessage(chat, [mine, blockedLast], blocked, 'u-you')?.id).toBe('m1');
  });

  it('returns undefined when only blocked messages are loaded', () => {
    const blockedLast = message('m2', 'bea@zilar.test', 2);
    const chat = { ...group, lastMessage: blockedLast };
    const messages = [message('m1', 'bea@zilar.test', 1), blockedLast];
    expect(previewMessage(chat, messages, blocked, 'u-you')).toBeUndefined();
  });

  it('returns undefined when no message is loaded', () => {
    const blockedLast = message('m2', 'bea@zilar.test', 2);
    const chat = { ...group, lastMessage: blockedLast };
    expect(previewMessage(chat, [], blocked, 'u-you')).toBeUndefined();
  });

  it('leaves a DM untouched', () => {
    const blockedLast = message('m1', 'bea@zilar.test', 1);
    const chat: ChatSummary = { ...group, kind: 'dm', lastMessage: blockedLast };
    expect(previewMessage(chat, [], blocked, 'u-you')).toBe(blockedLast);
  });

  it('leaves an AI chat untouched', () => {
    const blockedLast = message('m1', 'bea@zilar.test', 1);
    const chat: ChatSummary = { ...group, isAI: true, kind: 'ai', lastMessage: blockedLast };
    expect(previewMessage(chat, [], blocked, 'u-you')).toBe(blockedLast);
  });
});
