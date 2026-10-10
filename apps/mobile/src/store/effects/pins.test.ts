import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import type { PinsApi } from '../../lib/pins-api';
import { createRealChatStore } from '../real-store';
import { fakeApi } from '../test-support';
import { flushTasks as flush } from '@/test/wait';

const ANA = 'ana@zilar.test';
function anaApi(): ChatApi {
  return fakeApi({
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
  }) as unknown as ChatApi;
}

describe('pins on the effect fibers', () => {
  it('a loud load failure sets pinsError and a later success clears it', async () => {
    const listPins = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([]);
    const store = createRealChatStore({
      api: anaApi(),
      createXmpp: () => createFakeXmppCore(),
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
      api: anaApi(),
      createXmpp: () => createFakeXmppCore(),
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
