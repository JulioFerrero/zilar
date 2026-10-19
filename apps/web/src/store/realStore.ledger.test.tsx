import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore } from './realStore';

// The send-echo path of the message ledger, through the real web store: an
// echo that arrives before `sendMessage` resolves (T-0904).

const ANA = 'ana@zilar.test';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function echo(overrides: Partial<ChatMessage> & { id: string; chatJid: string }): ChatMessage {
  return {
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: 'me@zilar.test',
    fromResolved: true,
    timestamp: new Date('2026-09-28T12:02:00Z'),
    outgoing: true,
    ...overrides,
  };
}

async function setup(sends: Promise<{ id: string }>[]) {
  const pending = [...sends];
  const xmpp = fakeXmpp({
    sendMessage: vi.fn(() => pending.shift() ?? Promise.resolve({ id: 'srv-extra' })),
  });
  xmpp.history[ANA] = [
    {
      id: 'ana-1',
      kind: 'chat',
      chatJid: ANA,
      fromJid: ANA,
      fromResolved: true,
      body: 'question?',
      timestamp: new Date('2026-09-28T09:00:00Z'),
      outgoing: false,
    },
  ];
  const store = createRealChatStore({
    api: fakeApi(),
    storage: null,
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
  });
  store.getState().start();
  await flush();
  return { store, xmpp };
}

describe('send echoes through the web store', () => {
  it('links an echo that arrives before sendMessage resolves', async () => {
    const send = deferred<{ id: string }>();
    const { store, xmpp } = await setup([send.promise]);

    store.getState().sendText(ANA, 'hello');
    const local = store.getState().messages(ANA).at(-1)?.id ?? '';
    expect(local).toMatch(/^local-/);

    xmpp.emit('message', echo({ id: 'srv-1', chatJid: ANA, body: 'hello' }));
    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'hello')
        .map((m) => [m.id, m.status]),
    ).toEqual([['srv-1', 'sent']]);

    send.resolve({ id: 'srv-1' });
    await flush();

    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'hello')
        .map((m) => [m.id, m.status]),
    ).toEqual([['srv-1', 'sent']]);
    expect(store.getState().chats.find((c) => c.id === ANA)?.lastMessage?.id).toBe('srv-1');
    store.getState().react(ANA, local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'srv-1', ['👍']);
  });
});
