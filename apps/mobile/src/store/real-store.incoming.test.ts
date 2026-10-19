// Incoming events and actions of the mobile store that the older suites do not
// pin: reading a live message in the open chat and `sendTyping`.
import type { ChatMessage } from '@zilar/xmpp-core';
import { createFakeXmppCore, type FakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import { createRealChatStore, type AppStateLike } from './real-store';
import { fakeApi } from './test-support';
import { flushTasks as flush, waitFor } from '@/test/wait';

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const NOW = new Date('2026-09-28T12:00:00Z');

const entries: ChatEntry[] = [
  { kind: 'dm', chatJid: ANA, title: 'Ana', userId: 'u-ana' },
  {
    kind: 'group',
    chatJid: TEAM,
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
  },
];

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-09-28T11:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

function activeAppState(): AppStateLike {
  return {
    current: () => 'active',
    subscribe: () => () => {},
  };
}

async function setup(core: FakeXmppCore = createFakeXmppCore()) {
  const appState = activeAppState();
  const api = fakeApi({ getChats: vi.fn(async () => entries) });
  const store = createRealChatStore({
    api,
    appState,
    now: () => NOW,
    createXmpp: () => core,
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().chatsLoad).toBe('loaded'));
  await flush();
  return { store, core, api, appState };
}

const callsOf = (core: FakeXmppCore, method: string) =>
  core.calls.filter((call) => call.method === method).map((call) => call.args);

const chatOf = (store: Awaited<ReturnType<typeof setup>>['store'], chatId: string) =>
  store.getState().chats.find((chat) => chat.id === chatId);

describe('mobile incoming events, actions and reads', () => {
  it('reads a live message in the open chat while the app is active and sends a marker', async () => {
    const { store, core } = await setup();
    store.getState().openChat(ANA);
    await flush();
    const before = callsOf(core, 'markDisplayed').length;

    core.emit('message', message({ id: 'ana-live', chatJid: ANA, body: 'live' }));

    expect(chatOf(store, ANA)?.unread).toBe(0);
    expect(chatOf(store, ANA)?.lastMessage?.id).toBe('ana-live');
    expect(callsOf(core, 'markDisplayed').slice(before)).toEqual([[ANA, 'chat', 'ana-live']]);
    store.getState().stop();
  });

  it('sends typing with the chat kind and ignores an unknown chat', async () => {
    const { store, core } = await setup();

    store.getState().sendTyping(ANA);
    store.getState().sendTyping(TEAM);
    store.getState().sendTyping('nobody@zilar.test');

    expect(callsOf(core, 'sendTyping')).toEqual([
      [ANA, 'chat', 'composing'],
      [TEAM, 'groupchat', 'composing'],
    ]);
    store.getState().stop();
  });
});
