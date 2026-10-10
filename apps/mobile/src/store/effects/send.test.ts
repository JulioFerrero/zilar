import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import { createRealChatStore } from '../real-store';
import { fakeApi } from '../test-support';

const ANA = 'ana@zilar.test';

function anaApi(): ChatApi {
  return fakeApi({
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
  }) as unknown as ChatApi;
}

function core(sendMessage: XmppCore['sendMessage']): XmppCore {
  return {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    loadHistory: vi.fn(async () => ({ messages: [], complete: true, first: undefined })),
    sendMessage,
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: () => () => {},
  } as unknown as XmppCore;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function started(sendMessage: XmppCore['sendMessage']) {
  const store = createRealChatStore({
    api: anaApi(),
    createXmpp: () => core(sendMessage),
    now: () => new Date('2026-09-28T12:00:00Z'),
  });
  store.getState().start();
  await flush();
  await flush();
  return store;
}

describe('sending on the effect fibers', () => {
  it('calls sendMessage in the same tick as sendText and confirms the bubble', async () => {
    const sendMessage = vi.fn(async () => ({ id: 'srv-1' }));
    const store = await started(sendMessage);

    store.getState().sendText(ANA, ' hola ');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(store.getState().messages(ANA)[0]?.status).toBe('sending');

    await flush();
    expect(store.getState().messages(ANA)[0]?.status).toBe('sent');
    store.getState().stop();
  });

  it('keeps the bubble sending when the send rejects, without an error', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('down');
    });
    const store = await started(sendMessage);

    store.getState().sendText(ANA, 'hola');
    await flush();
    expect(store.getState().messages(ANA)[0]?.status).toBe('sending');
    expect(store.getState().actionError).toBeUndefined();
    store.getState().stop();
  });

  it('stop interrupts a send in flight: a late ack changes nothing', async () => {
    let ack!: (value: { id: string }) => void;
    const sendMessage = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          ack = resolve;
        }),
    );
    const store = await started(sendMessage);

    store.getState().sendText(ANA, 'hola');
    const before = store.getState().messages(ANA);
    store.getState().stop();
    ack({ id: 'srv-late' });
    await flush();
    expect(store.getState().messages(ANA)).toBe(before);
  });
});
