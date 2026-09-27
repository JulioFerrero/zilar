import { describe, expect, it } from 'vitest';
import type { UiMessage } from '@galena/chat-core';
import { ApprovalRequestSchema, PayloadSchema } from '@galena/protocol';
import { mockChats, mockMessages } from '@/mock';

const allMessages: UiMessage[] = Object.values(mockMessages).flat();

describe('mock data', () => {
  it('has at least ten chats', () => {
    expect(mockChats.length).toBeGreaterThanOrEqual(10);
  });

  it('covers the required chat cases', () => {
    expect(mockChats.some((chat) => chat.id === 'c-ana' && chat.unread === 2 && chat.online)).toBe(
      true,
    );
    expect(mockChats.some((chat) => chat.title === 'Viernes 🍻' && chat.memberCount === 5)).toBe(
      true,
    );
    expect(mockChats.some((chat) => chat.muted && chat.unread > 0)).toBe(true);
    expect(mockChats.some((chat) => chat.title === 'Dev team')).toBe(true);
    expect(mockChats.some((chat) => chat.isAI && chat.aiStatus === 'working')).toBe(true);
    expect(mockChats.some((chat) => chat.isAI && chat.aiStatus === 'idle')).toBe(true);
  });

  it('has at least three threads with twenty or more messages', () => {
    expect(Object.values(mockMessages).filter((list) => list.length >= 20).length).toBe(3);
  });

  it('includes replies, voice, image, progress and approval messages', () => {
    expect(allMessages.some((message) => message.voice?.transcript !== undefined)).toBe(true);
    expect(allMessages.some((message) => message.image !== undefined)).toBe(true);
    expect(allMessages.some((message) => message.card?.type === 'progress')).toBe(true);
    expect(allMessages.some((message) => message.card?.type === 'approval.request')).toBe(true);
    expect(allMessages.some((message) => message.replyTo !== undefined)).toBe(true);
  });

  it('uses only inline data URIs for images', () => {
    const urls = allMessages.flatMap((message) =>
      message.image === undefined ? [] : [message.image.url],
    );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('has only valid card payloads and a valid approval request', () => {
    for (const message of allMessages) {
      if (message.card !== undefined) {
        expect(PayloadSchema.safeParse(message.card).success).toBe(true);
      }
    }

    const approval = allMessages.find((message) => message.card?.type === 'approval.request');
    expect(approval).toBeDefined();
    if (approval?.card?.type === 'approval.request') {
      expect(ApprovalRequestSchema.safeParse(approval.card.data).success).toBe(true);
    }
  });
});
