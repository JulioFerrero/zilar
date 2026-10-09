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

  it('fails if the search list lets an unexpected jump error vanish', async () => {
    // `openSearchHitEffect` fails on anything but the not-found signal, and a
    // router throw is a defect, so the call site must catch both and show the
    // miss notice instead of leaving the user on a spinner (an unhandled
    // failure).
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const list = readFileSync(join(here, 'message-search-list.tsx'), 'utf8');
    const call = list.slice(list.indexOf('openSearchHitEffect('));
    expect(call.slice(0, 900)).toContain('Effect.catch(');
    expect(call.slice(0, 900)).toContain('Effect.catchDefect(');
    expect(call.slice(0, 900)).toContain('notFoundRef.current');
  });
});
