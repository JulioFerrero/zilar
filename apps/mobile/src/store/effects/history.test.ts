import type { XmppCore } from '@zilar/xmpp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import { createRealChatStore, MESSAGE_JUMP_WAIT_MS } from '../real-store';

const ANA = 'ana@zilar.test';

function fakeApi(): ChatApi {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
    getContacts: vi.fn(async () => []),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  } as unknown as ChatApi;
}

// A core whose first history load (the previews) answers at once and whose
// later loads never answer, so a chat open stays "in flight".
function hangingCore(): XmppCore {
  let calls = 0;
  return {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    loadHistory: vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ messages: [], complete: false, first: undefined })
        : new Promise(() => {});
    }),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: () => () => {},
  } as unknown as XmppCore;
}

describe('history on the effect fibers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('openAtMessage gives up when the opening page stalls past the wait cap', async () => {
    vi.useFakeTimers();
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => hangingCore(),
      now: () => new Date('2026-09-28T12:00:00Z'),
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().status).toBe('online');

    const jump = store.getState().openAtMessage(ANA, 'missing');
    const settled = expect(jump).rejects.toThrow('message_not_found');
    await vi.advanceTimersByTimeAsync(MESSAGE_JUMP_WAIT_MS - 1);
    expect(store.getState().jumpTarget).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    store.getState().stop();
  });

  it('stop interrupts a history load in flight and leaves nothing behind', async () => {
    const core = hangingCore();
    const store = createRealChatStore({ api: fakeApi(), createXmpp: () => core });
    store.getState().start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().openChat(ANA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().historyLoad[ANA]).toBe('loading');

    store.getState().stop();
    store.getState().start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The new session can load the chat again: the stale load did not keep
    // the in-flight marker.
    store.getState().retryHistory(ANA);
    expect(core.loadHistory).toHaveBeenCalledTimes(4);
    store.getState().stop();
  });
});
