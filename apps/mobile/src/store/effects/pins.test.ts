import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import type { PinsApi } from '../../lib/pins-api';
import { createRealChatStore } from '../real-store';

const ANA = 'ana@zilar.test';
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

const fakeCore = (): XmppCore =>
  ({
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    loadHistory: vi.fn(async () => ({ messages: [], complete: true, first: undefined })),
    on: () => () => {},
  }) as unknown as XmppCore;

describe('pins on the effect fibers', () => {
  it('a loud load failure sets pinsError and a later success clears it', async () => {
    const listPins = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([]);
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => fakeCore(),
      pinsApi: { listPins } as unknown as PinsApi,
    });
    store.getState().start();
    await flush();

    await store.getState().refreshPins(ANA);
    expect(store.getState().pinsError).toEqual({
      chatId: ANA,
      message: 'Could not load pins. Try again.',
    });
    await store.getState().refreshPins(ANA);
    expect(store.getState().pinsError).toBeUndefined();
    store.getState().stop();
  });

  it('unpin rolls back and rejects when the server refuses', async () => {
    const pin = {
      id: 'p1',
      chat: ANA,
      messageId: 'm1',
      senderName: 'Ana',
      text: 'hi',
      kind: 'text',
      pinnedBy: 'u-ana',
      pinnedAt: '2026-09-28T12:00:00.000Z',
    };
    const store = createRealChatStore({
      api: fakeApi(),
      createXmpp: () => fakeCore(),
      pinsApi: {
        listPins: vi.fn(async () => [pin]),
        unpinMessage: vi.fn(async () => {
          throw new Error('nope');
        }),
      } as unknown as PinsApi,
    });
    store.getState().start();
    await flush();
    await store.getState().refreshPins(ANA);
    expect(store.getState().pins(ANA)).toHaveLength(1);

    await expect(store.getState().unpinMessage(ANA, 'p1')).rejects.toThrow('nope');
    expect(store.getState().pins(ANA)).toHaveLength(1);
    expect(store.getState().pinsError?.message).toBe('Could not unpin. Try again.');
    store.getState().stop();
  });
});
