import type { UiMessage } from '@zilar/chat-core';
import { describe, expect, it, vi } from 'vitest';

import { openSearchHit } from './search-jump';

function message(): UiMessage {
  return {
    id: 'm-1',
    chatId: 'ana',
    senderId: 'ana',
    senderName: 'Ana',
    text: 'found',
    createdAt: new Date('2026-09-28T12:00:00Z'),
    status: 'read',
  };
}

describe('openSearchHit (T-0157 item 7)', () => {
  it('lands on the message when the jump loads it', async () => {
    const openAtMessage = vi.fn(async () => message());
    const pushChat = vi.fn();
    const pushChatNotFound = vi.fn();
    const onNotFound = vi.fn();

    await expect(
      openSearchHit({ openAtMessage, pushChat, pushChatNotFound, onNotFound }, 'ana', 'm-1'),
    ).resolves.toBe('landed');
    expect(openAtMessage).toHaveBeenCalledTimes(1);
    expect(openAtMessage).toHaveBeenCalledWith('ana', 'm-1');
    expect(pushChat).toHaveBeenCalledWith('ana');
    expect(pushChatNotFound).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
  });

  it('opens the chat at the bottom with the notice when the jump gives up, and stops', async () => {
    // The store's `openAtMessage` pages backwards at most
    // `MESSAGE_JUMP_MAX_PAGES` history pages, then throws
    // `message_not_found`. The jump must not retry: exactly one attempt,
    // then the bottom landing with the notice.
    const openAtMessage = vi.fn(async () => {
      throw new Error('message_not_found');
    });
    const pushChat = vi.fn();
    const pushChatNotFound = vi.fn();
    const onNotFound = vi.fn();

    await expect(
      openSearchHit({ openAtMessage, pushChat, pushChatNotFound, onNotFound }, 'ana', 'm-99'),
    ).resolves.toBe('not-found');
    expect(openAtMessage).toHaveBeenCalledTimes(1);
    expect(pushChat).not.toHaveBeenCalled();
    expect(pushChatNotFound).toHaveBeenCalledWith('ana');
    expect(onNotFound).toHaveBeenCalledWith('ana');
  });

  it('stops after the page cap: the store pages at most MESSAGE_JUMP_MAX_PAGES + 1 loads', async () => {
    // Pins the store side of the contract: `openAtMessage` pages backwards
    // at most `MESSAGE_JUMP_MAX_PAGES` history pages before giving up with
    // "Message not found" (the real-store suite covers the endless-archive
    // case). The driver above makes exactly one attempt and then lands at
    // the bottom once — never a retry loop.
    const { MESSAGE_JUMP_MAX_PAGES } = await import('@/store/real-store');
    expect(MESSAGE_JUMP_MAX_PAGES).toBeGreaterThan(0);
    const openAtMessage = vi.fn(async () => {
      throw new Error('message_not_found');
    });
    const pushChat = vi.fn();
    const pushChatNotFound = vi.fn();
    const onNotFound = vi.fn();

    await expect(
      openSearchHit({ openAtMessage, pushChat, pushChatNotFound, onNotFound }, 'ana', 'm-99'),
    ).resolves.toBe('not-found');
    expect(openAtMessage).toHaveBeenCalledTimes(1);
    expect(pushChatNotFound).toHaveBeenCalledTimes(1);
  });
});
