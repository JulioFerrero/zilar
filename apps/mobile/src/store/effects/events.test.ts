import type { XmppCore } from '@zilar/xmpp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import { createRealChatStore } from '../real-store';
import { CHAT_REFRESH_DEBOUNCE_MS, TYPING_CLEAR_MS } from './events';

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

type Handlers = Record<string, ((event: unknown) => void) | undefined>;

function fakeCore(handlers: Handlers): XmppCore {
  return {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    loadHistory: vi.fn(async () => ({ messages: [], complete: true, first: undefined })),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: (name: string, handler: (event: unknown) => void) => {
      handlers[name] = handler;
      return () => {
        handlers[name] = undefined;
      };
    },
  } as unknown as XmppCore;
}

describe('events on the effect fibers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the typing line and clears it after the timeout', async () => {
    vi.useFakeTimers();
    const handlers: Handlers = {};
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => fakeCore(handlers),
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);

    const typing = handlers.typing;
    expect(typing).toBeDefined();
    typing?.({ chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    expect(store.getState().typing[ANA]).toEqual({ names: ['Ana'] });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1);
    expect(store.getState().typing[ANA]).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(store.getState().typing[ANA]).toBeUndefined();
    store.getState().stop();
  });

  it('a second composing restarts the timeout and an active state clears at once', async () => {
    vi.useFakeTimers();
    const handlers: Handlers = {};
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => fakeCore(handlers),
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);

    const typing = handlers.typing;
    typing?.({ chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1000);
    typing?.({ chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1000);
    expect(store.getState().typing[ANA]).toBeDefined();
    typing?.({ chatJid: ANA, fromJid: ANA, state: 'active', outgoing: false });
    expect(store.getState().typing[ANA]).toBeUndefined();
    store.getState().stop();
  });

  it('debounces roster pushes into one chat list refresh', async () => {
    vi.useFakeTimers();
    const handlers: Handlers = {};
    const api = fakeApi();
    const store = createRealChatStore({ api, createXmpp: () => fakeCore(handlers) });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);
    const before = vi.mocked(api.getChats).mock.calls.length;

    handlers.roster?.({});
    await vi.advanceTimersByTimeAsync(CHAT_REFRESH_DEBOUNCE_MS - 1);
    handlers.roster?.({});
    await vi.advanceTimersByTimeAsync(CHAT_REFRESH_DEBOUNCE_MS - 1);
    expect(vi.mocked(api.getChats).mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(api.getChats).mock.calls.length).toBe(before + 1);
    store.getState().stop();
  });

  it('stop ends a pending typing timer', async () => {
    vi.useFakeTimers();
    const handlers: Handlers = {};
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => fakeCore(handlers),
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);
    handlers.typing?.({ chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    store.getState().stop();
    vi.advanceTimersByTime(TYPING_CLEAR_MS * 2);
    // The line stays as it was: nothing ran after stop.
    expect(store.getState().typing[ANA]).toEqual({ names: ['Ana'] });
  });
});
