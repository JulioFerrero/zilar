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

  it('lets an unexpected error propagate instead of mis-landing at the bottom', async () => {
    // Finding 4: only the `message_not_found` signal lands at the bottom.
    // A programming error (or a router failure) must surface, not silently
    // open the wrong place.
    const openAtMessage = vi.fn(async () => {
      throw new TypeError('cannot read property of undefined');
    });
    const pushChat = vi.fn();
    const pushChatNotFound = vi.fn();
    const onNotFound = vi.fn();

    await expect(
      openSearchHit({ openAtMessage, pushChat, pushChatNotFound, onNotFound }, 'ana', 'm-99'),
    ).rejects.toBeInstanceOf(TypeError);
    expect(pushChat).not.toHaveBeenCalled();
    expect(pushChatNotFound).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
  });
});
