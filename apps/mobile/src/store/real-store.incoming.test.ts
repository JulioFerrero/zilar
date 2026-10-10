// Incoming events, message actions and reads of the mobile store that the
// older suites do not pin: the typing clear on `paused`, a live message in the
// open chat (foreground and background), occupants, presence, `sendTyping`,
// and edits and reactions made between a send's ack and its echo.
import type { ChatMessage } from '@zilar/xmpp-core';
import { createFakeXmppCore, type FakeXmppCore } from '@zilar/xmpp-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import { createRealChatStore, type AppStateLike } from './real-store';
import { TYPING_CLEAR_MS } from './effects/events';
import { fakeApi } from './test-support';
import { flushTasks as flush, waitFor } from '@/test/wait';

const ME = 'me@zilar.test';
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

interface SwitchableAppState extends AppStateLike {
  setBackground(): void;
}

function switchableAppState(): SwitchableAppState {
  let state = 'active';
  return {
    current: () => state,
    subscribe: () => () => {},
    setBackground() {
      state = 'background';
    },
  };
}

async function setup(core: FakeXmppCore = createFakeXmppCore()) {
  const appState = switchableAppState();
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the typing line at once on paused, and a cancelled wait never clears a later line', async () => {
    vi.useFakeTimers();
    const { store, core } = await setup();

    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    expect(store.getState().typing[ANA]).toEqual({ names: ['Ana'] });
    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'paused', outgoing: false });
    expect(store.getState().typing[ANA]).toBeUndefined();

    vi.advanceTimersByTime(1000);
    core.emit('typing', { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    // The first wait would have ended here; it was cancelled by `paused`.
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1000);
    expect(store.getState().typing[ANA]).toEqual({ names: ['Ana'] });
    vi.advanceTimersByTime(1000);
    expect(store.getState().typing[ANA]).toBeUndefined();
    store.getState().stop();
  });

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

  it('counts a live message in the open chat as unread while the app is in the background', async () => {
    const { store, core, appState } = await setup();
    store.getState().openChat(ANA);
    await flush();
    const before = callsOf(core, 'markDisplayed').length;
    appState.setBackground();

    core.emit('message', message({ id: 'ana-bg', chatJid: ANA, body: 'while away' }));

    expect(chatOf(store, ANA)?.unread).toBe(1);
    expect(callsOf(core, 'markDisplayed').length).toBe(before);
    store.getState().stop();
  });

  it('counts online occupants and never shrinks the member count', async () => {
    const { store, core } = await setup();
    const occupant = (nick: string, available: boolean) => ({
      jid: `${TEAM}/${nick}`,
      nick,
      available,
    });

    core.emit('occupants', {
      roomJid: TEAM,
      occupants: [occupant('ana', true), occupant('bob', false)],
    });
    expect(chatOf(store, TEAM)?.onlineCount).toBe(1);
    expect(chatOf(store, TEAM)?.memberCount).toBe(3);

    core.emit('occupants', {
      roomJid: TEAM,
      occupants: [
        occupant('ana', true),
        occupant('bob', true),
        occupant('cy', true),
        occupant('di', false),
      ],
    });
    expect(chatOf(store, TEAM)?.onlineCount).toBe(3);
    expect(chatOf(store, TEAM)?.memberCount).toBe(4);
    store.getState().stop();
  });

  it('marks a DM online, then offline with a last-seen time', async () => {
    const { store, core } = await setup();

    core.emit('presence', { jid: ANA, available: true });
    expect(chatOf(store, ANA)?.online).toBe(true);
    expect(chatOf(store, ANA)?.lastSeenAt).toBeUndefined();

    core.emit('presence', { jid: ANA, available: false });
    expect(chatOf(store, ANA)?.online).toBe(false);
    expect(chatOf(store, ANA)?.lastSeenAt).toEqual(NOW);
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

  it('keeps an edit made after the ack when the echo arrives', async () => {
    const { store, core } = await setup();
    store.getState().sendText(ANA, 'hello');
    await waitFor(() => expect(store.getState().messages(ANA).at(-1)?.status).toBe('sent'));
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';

    store.getState().editMessage(ANA, localId, 'hello there');
    await flush();
    expect(store.getState().messages(ANA).at(-1)?.text).toBe('hello there');

    core.emit(
      'message',
      message({ id: 'srv-1', chatJid: ANA, body: 'hello', fromJid: ME, outgoing: true }),
    );

    const bubbles = store.getState().messages(ANA);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.text).toBe('hello there');
    expect(bubbles[0]?.edited).toBe(true);
    store.getState().stop();
  });

  it('keeps a reaction made after the ack when the group echo arrives', async () => {
    const { store, core } = await setup();
    store.getState().sendText(TEAM, 'hi team');
    await waitFor(() => expect(store.getState().messages(TEAM).at(-1)?.status).toBe('sent'));
    const localId = store.getState().messages(TEAM).at(-1)?.id ?? '';

    store.getState().react(TEAM, localId, '👍');
    await flush();
    expect(callsOf(core, 'sendReactions')).toEqual([[TEAM, 'groupchat', 'srv-1', ['👍']]]);

    core.emit(
      'message',
      message({
        id: 'room-1',
        originId: 'srv-1',
        chatJid: TEAM,
        body: 'hi team',
        fromJid: ME,
        outgoing: true,
      }),
    );

    const bubbles = store.getState().messages(TEAM);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.id).toBe('room-1');
    expect(bubbles[0]?.reactions).toEqual([
      expect.objectContaining({ emoji: '👍', count: 1, mine: true }),
    ]);
    store.getState().stop();
  });
});
