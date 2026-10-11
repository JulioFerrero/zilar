import { describe, expect, it } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { inTabNotification, type InTabMessage } from './inTab';

const NOW = new Date('2026-10-11T12:00:00Z');

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'ana@zilar.test',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function message(overrides: Partial<InTabMessage> = {}): InTabMessage {
  return {
    id: 'm-1',
    chatId: 'ana@zilar.test',
    senderId: 'ana@zilar.test',
    senderName: 'Ana',
    text: 'see you at six',
    createdAt: NOW,
    status: 'read',
    ...overrides,
  } satisfies UiMessage;
}

describe('inTabNotification', () => {
  it('shows the sender and text for a hidden tab, an unmuted chat and granted permission', () => {
    const decision = inTabNotification({
      chat: chat(),
      message: message({ originId: 'origin-1' }),
      permission: 'granted',
      hidden: true,
      showPreviews: true,
    });

    expect(decision).toEqual({
      title: 'Ana',
      body: 'see you at six',
      tag: 'origin-1',
      chatId: 'ana@zilar.test',
    });
  });

  it('falls back to "New message" when previews are off', () => {
    const decision = inTabNotification({
      chat: chat(),
      message: message(),
      permission: 'granted',
      hidden: true,
      showPreviews: false,
    });

    expect(decision?.body).toBe('New message');
  });

  it('shows nothing for a muted chat', () => {
    const decision = inTabNotification({
      chat: chat({ muted: true }),
      message: message(),
      permission: 'granted',
      hidden: true,
      showPreviews: true,
    });

    expect(decision).toBeUndefined();
  });

  it('shows nothing without granted permission', () => {
    const decision = inTabNotification({
      chat: chat(),
      message: message(),
      permission: 'default',
      hidden: true,
      showPreviews: true,
    });

    expect(decision).toBeUndefined();
  });
});
