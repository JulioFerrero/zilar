import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import { waitFor } from '@/test/wait';

import { createRealChatStore } from './real-store';
import { fakeApi, fakeAppState } from './test-support';
import type { ChatStoreState } from './types';

const PEER = 'peer@zilar.test';

function peerMessage(id: string, body: string): ChatMessage {
  return {
    id,
    chatJid: PEER,
    kind: 'chat',
    fromJid: PEER,
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    body,
  };
}

function userSession(input: { userId: string; contactName: string; body: string }) {
  const api = fakeApi({
    getMe: vi.fn(async () => ({
      id: input.userId,
      email: `${input.userId}@zilar.test`,
      name: input.userId,
      jid: `${input.userId}@zilar.test`,
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: PEER, title: 'Peer', userId: 'u-peer' },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-peer', name: input.contactName, jid: PEER }]),
  });
  const core: XmppCore = createFakeXmppCore({
    loadHistory: vi.fn(async () => ({
      messages: [peerMessage(`${input.userId}-1`, input.body)],
      complete: false,
      first: `${input.userId}-1`,
    })),
  });
  return { api, core };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  await waitFor(predicate);
}

/** One store, two users in turn: the api and the XMPP core follow `active`. */
function setup() {
  const sessions = [
    userSession({ userId: 'u-a', contactName: 'Peer for A', body: 'secret for A' }),
    userSession({ userId: 'u-b', contactName: 'Peer for B', body: 'hello B' }),
  ];
  let index = 0;
  const active = () => sessions[index]?.api as ChatApi;
  const api: ChatApi = {
    getMe: () => active().getMe(),
    getChats: () => active().getChats(),
    getContacts: () => active().getContacts(),
    getGroup: (groupId) => active().getGroup(groupId),
    getXmppToken: () => active().getXmppToken(),
  };
  const store = createRealChatStore({
    api,
    appState: fakeAppState(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    openDrafts: () => () => {},
    createXmpp: () => sessions[index]?.core as XmppCore,
  });
  return {
    store,
    signInNextUser: () => {
      index += 1;
    },
  };
}

function bodiesOf(state: ChatStoreState): string[] {
  return Object.values(state.messagesByChat)
    .flat()
    .flatMap((item) => (item.text === undefined ? [] : [item.text]));
}

describe('sign-out clears the user scoped store state (T-0901)', () => {
  it('resets every user scoped field to its initial value on stop()', async () => {
    const { store } = setup();
    store.getState().start();
    await flushUntil(() => store.getState().chatsLoad === 'loaded');
    store.getState().openChat(PEER);
    await flushUntil(() => store.getState().historyLoad[PEER] === 'loaded');
    store.getState().setFolders([
      {
        id: 'f-1',
        name: 'Work',
        icon: 'briefcase',
        position: 0,
        includeTypes: ['group'],
        includeChats: [],
        excludeChats: [],
        excludeMuted: false,
        excludeRead: false,
      },
    ]);
    store.getState().startEdit(PEER, 'u-a-1');
    store.setState({ actionError: { chatId: PEER, message: 'Could not save the edit.' } });

    const before = store.getState();
    expect(before.me?.id).toBe('u-a');
    expect(before.chats.length).toBeGreaterThan(0);
    expect(before.contacts.length).toBeGreaterThan(0);
    expect(bodiesOf(before)).toContain('secret for A');
    expect(before.hasMore(PEER)).toBe(true);

    store.getState().stop();

    const after = store.getState();
    const initial = store.getInitialState();
    expect(after.chats).toEqual([]);
    expect(after.contacts).toEqual([]);
    expect(after.messagesByChat).toEqual({});
    expect(after.me).toBeUndefined();
    expect(after.currentUserId).toBe(initial.currentUserId);
    expect(after.historyLoad).toEqual({});
    expect(after.historyComplete).toEqual({});
    expect(after.hasMore(PEER)).toBe(false);
    expect(after.activeChatId).toBeNull();
    expect(after.folders).toEqual([]);
    expect(after.foldersLoaded).toBe(false);
    expect(after.ownedAis).toEqual(initial.ownedAis);
    expect(after.typing).toEqual({});
    expect(after.editTarget).toBeUndefined();
    expect(after.actionError).toBeUndefined();
    expect(after.chatsLoad).toBe(initial.chatsLoad);
    expect(after.status).toBe('offline');
  });

  it('never shows the first user messages with the same peer to the next user', async () => {
    const { store, signInNextUser } = setup();
    store.getState().start();
    await flushUntil(() => store.getState().chatsLoad === 'loaded');
    store.getState().openChat(PEER);
    await flushUntil(() => store.getState().historyLoad[PEER] === 'loaded');
    expect(bodiesOf(store.getState())).toContain('secret for A');
    store.getState().stop();

    signInNextUser();
    store.getState().start();
    expect(bodiesOf(store.getState())).not.toContain('secret for A');
    expect(store.getState().chats).toEqual([]);
    expect(store.getState().contacts).toEqual([]);

    await flushUntil(() => store.getState().chatsLoad === 'loaded');
    expect(store.getState().me?.id).toBe('u-b');
    expect(store.getState().contacts.map((contact) => contact.name)).toEqual(['Peer for B']);
    expect(bodiesOf(store.getState())).not.toContain('secret for A');

    store.getState().openChat(PEER);
    await flushUntil(() => store.getState().historyLoad[PEER] === 'loaded');
    const bodies = bodiesOf(store.getState());
    expect(bodies).toContain('hello B');
    expect(bodies).not.toContain('secret for A');
    store.getState().stop();
  });
});
