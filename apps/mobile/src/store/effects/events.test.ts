import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRealChatStore } from '../real-store';
import { fakeApi } from '../test-support';
import { CHAT_REFRESH_DEBOUNCE_MS, TYPING_CLEAR_MS } from './events';

const ANA = 'ana@zilar.test';

function anaApi() {
  return fakeApi({
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
  });
}

describe('events on the effect fibers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the typing line and clears it after the timeout', async () => {
    vi.useFakeTimers();
    const core = createFakeXmppCore();
    const store = createRealChatStore({
      api: anaApi(),
      createXmpp: () => core,
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);

    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    expect(store.getState().typing[ANA]).toEqual({ names: ['Ana'] });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1);
    expect(store.getState().typing[ANA]).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(store.getState().typing[ANA]).toBeUndefined();
    store.getState().stop();
  });

  it('a second composing restarts the timeout and an active state clears at once', async () => {
    vi.useFakeTimers();
    const core = createFakeXmppCore();
    const store = createRealChatStore({
      api: anaApi(),
      createXmpp: () => core,
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);

    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1000);
    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1000);
    expect(store.getState().typing[ANA]).toBeDefined();
    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'active', outgoing: false });
    expect(store.getState().typing[ANA]).toBeUndefined();
    store.getState().stop();
  });

  it('debounces roster pushes into one chat list refresh', async () => {
    vi.useFakeTimers();
    const core = createFakeXmppCore();
    const api = anaApi();
    const store = createRealChatStore({ api, createXmpp: () => core });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);
    const before = vi.mocked(api.getChats).mock.calls.length;

    core.emit('roster', { jid: ANA, subscription: 'both' });
    await vi.advanceTimersByTimeAsync(CHAT_REFRESH_DEBOUNCE_MS - 1);
    core.emit('roster', { jid: ANA, subscription: 'both' });
    await vi.advanceTimersByTimeAsync(CHAT_REFRESH_DEBOUNCE_MS - 1);
    expect(vi.mocked(api.getChats).mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(api.getChats).mock.calls.length).toBe(before + 1);
    store.getState().stop();
  });

  it('stop ends a pending typing timer', async () => {
    vi.useFakeTimers();
    const core = createFakeXmppCore();
    const store = createRealChatStore({
      api: anaApi(),
      createXmpp: () => core,
    });
    store.getState().start();
    await vi.advanceTimersByTimeAsync(10);
    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    store.getState().stop();
    expect(store.getState().typing).toEqual({});
    const writes = vi.fn();
    const unsubscribe = store.subscribe(writes);
    vi.advanceTimersByTime(TYPING_CLEAR_MS * 2);
    unsubscribe();
    // No timer writes state after stop.
    expect(writes).not.toHaveBeenCalled();
    expect(store.getState().typing).toEqual({});
  });
});
