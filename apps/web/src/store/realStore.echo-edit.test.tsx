import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore } from './realStore';

// A send, its ack, a following edit (or reaction), then the outgoing echo: the
// echo merges the optimistic id into the server id and must keep the edit and
// the reaction filed in between (T-0916). On the old core it re-showed the
// sent text and dropped the reaction.

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const ME = 'me@zilar.test';

function echo(overrides: Partial<ChatMessage> & { id: string; chatJid: string }): ChatMessage {
  return {
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ME,
    fromResolved: true,
    timestamp: new Date('2026-09-28T12:02:00Z'),
    outgoing: true,
    ...overrides,
  };
}

async function setup() {
  const xmpp = fakeXmpp();
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

describe('the outgoing echo keeps a later edit and reaction', () => {
  it('keeps an edit made after the ack when the echo arrives', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendText(ANA, 'hello');
    const local = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flush();

    store.getState().editMessage(ANA, local, 'hello there');
    await flush();
    expect(store.getState().messages(ANA).at(-1)?.text).toBe('hello there');

    xmpp.emit('message', echo({ id: 'srv-1', chatJid: ANA, body: 'hello' }));

    const bubbles = store.getState().messages(ANA);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.text).toBe('hello there');
    expect(bubbles[0]?.edited).toBe(true);
  });

  it('keeps a reaction made after the ack when the group echo arrives', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendText(TEAM, 'hi team');
    const local = store.getState().messages(TEAM).at(-1)?.id ?? '';
    await flush();

    store.getState().react(TEAM, local, '👍');
    await flush();
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(TEAM, 'groupchat', 'srv-1', ['👍']);

    xmpp.emit('message', echo({ id: 'room-1', originId: 'srv-1', chatJid: TEAM, body: 'hi team' }));

    const bubbles = store.getState().messages(TEAM);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.id).toBe('room-1');
    expect(bubbles[0]?.reactions).toEqual([
      expect.objectContaining({ emoji: '👍', count: 1, mine: true }),
    ]);
  });
});
