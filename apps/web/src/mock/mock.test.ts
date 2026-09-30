import { describe, expect, it } from 'vitest';
import type { UiMessage } from '@galena/chat-core';
import { ApprovalRequestSchema, PayloadSchema, StickerSchema } from '@galena/protocol';
import { mockChats, mockMessages } from '@/mock';
import { mockDemoStickerPacks } from './helpers';
import { mockRequest, resetMockApi, setMockDelay } from './api';

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

describe('mock sticker demo packs (T-0120)', () => {
  it('ships two packs of generated SVG data-URL stickers', () => {
    const packs = mockDemoStickerPacks();
    expect(packs).toHaveLength(2);
    for (const pack of packs) {
      expect(pack.title.length).toBeGreaterThan(0);
      expect(pack.stickers.length).toBeGreaterThan(0);
      for (const sticker of pack.stickers) {
        expect(sticker.url.startsWith('data:image/svg+xml,')).toBe(true);
        expect(sticker.emoji.length).toBeGreaterThan(0);
      }
    }
  });

  it('serves the demo packs as the panel list and discover results', async () => {
    setMockDelay(0);
    resetMockApi();
    try {
      const panel = (await (await mockRequest('/sticker-packs')).json()) as {
        packs: Array<{ id: string; stickers: unknown[] }>;
      };
      expect(panel.packs).toHaveLength(2);
      expect(panel.packs.every((pack) => pack.stickers.length > 0)).toBe(true);

      const discover = (await (await mockRequest('/sticker-packs/discover')).json()) as {
        packs: Array<{ id: string }>;
        next: null;
      };
      expect(discover.packs).toHaveLength(2);
      expect(discover.next).toBeNull();
    } finally {
      resetMockApi();
    }
  });

  it('keeps demo sticker payloads valid against the protocol schema', () => {
    const packs = mockDemoStickerPacks();
    const first = packs[0]!.stickers[0]!;
    expect(
      StickerSchema.safeParse({
        pack_id: '123e4567-e89b-12d3-a456-426614174000',
        sticker_id: '223e4567-e89b-12d3-a456-426614174001',
        url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
        emoji: first.emoji,
        width: 200,
        height: 200,
        mime: 'image/png',
      }).success,
    ).toBe(true);
  });
});
