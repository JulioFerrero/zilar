import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps, type StorageLike } from './realStore';

// Incoming events and message actions through the real web store, for the
// paths no other store test covers (T-0907, written on the old code before the
// move to `@zilar/client-core/store`).

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const NOW = new Date('2026-09-28T12:00:00Z');

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function message(overrides: Partial<ChatMessage> & { id: string; chatJid: string }): ChatMessage {
  return {
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ANA,
    fromResolved: true,
    body: overrides.id,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  xmpp.history[ANA] = [message({ id: 'ana-1', chatJid: ANA, body: 'older' })];
  const storage = memoryStorage();
  const store = createRealChatStore({
    api: fakeApi(),
    storage,
    now: () => NOW,
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, xmpp, storage };
}

describe('message actions', () => {
  it('sends the typing signal with the chat kind, and nothing for an unknown chat', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendTyping(TEAM);
    store.getState().sendTyping('nobody@zilar.test');

    expect(xmpp.core.sendTyping).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendTyping).toHaveBeenCalledWith(TEAM, 'groupchat', 'composing');
  });
});
