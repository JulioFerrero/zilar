import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import { createChatStore } from './chat-store';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeAppState } from './test-support';

function fakeXmpp(): { core: XmppCore; sent: unknown[] } {
  const sent: unknown[] = [];
  const core = {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    sendMessage: vi.fn(async (_to: string, _kind: unknown, _text: string, opts?: unknown) => {
      sent.push(opts);
      return { id: 'srv-1' };
    }),
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'srv-c' })),
    sendRetraction: vi.fn(async () => {}),
    requestUploadSlot: vi.fn(async () => ({ putUrl: '', getUrl: '', headers: {} })),
    loadHistory: vi.fn(async () => ({ messages: [] as ChatMessage[], complete: true })),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: vi.fn(() => () => {}),
  } as unknown as XmppCore;
  return { core, sent };
}

function fakeApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async () => [
      {
        kind: 'group' as const,
        chatJid: 'team@rooms.zilar.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'member' as const,
      },
    ]),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [
        { userId: 'u-ana', name: 'Ana', role: 'member' as const, roles: [], handle: 'ana' },
        { userId: 'u-luis', name: 'Luis', role: 'member' as const, roles: [] },
      ],
      ais: [{ aiId: 'dev-ai', jid: 'ai-dev-ai@zilar.test', name: 'Dev AI', ownerId: 'u-me' }],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi();
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    appState: fakeAppState(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp };
}

const CHAT = 'team@rooms.zilar.test';

describe('real store mentions (T-0227)', () => {
  it('exposes group members with handles plus the group AIs', async () => {
    const { store } = await setup();
    store.getState().openChat(CHAT);
    await flush();

    expect(store.getState().groupMembers(CHAT)).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana', handle: 'ana' },
      { jid: 'u-luis@zilar.test', name: 'Luis' },
      { jid: 'ai-dev-ai@zilar.test', name: 'Dev AI' },
    ]);
  });

  it('never lists yourself when `me` is undefined (T-0227 S2)', () => {
    // The mock store never sets `me`, and the real store is briefly unset
    // pre-boot — exclusion runs on `currentUserId`, which is always set,
    // so the screen's `me?.jid` filter is only a second layer.
    const mock = createChatStore();
    expect(mock.getState().me).toBeUndefined();
    const members = mock.getState().groupMembers('dev-team');
    expect(members.length).toBeGreaterThan(0);
    expect(members.some((member) => member.jid === 'me@zilar.test')).toBe(false);
    expect(members.some((member) => member.name === 'You')).toBe(false);
  });

  it('returns no members for an unknown chat', async () => {
    const { store } = await setup();

    expect(store.getState().groupMembers('missing@rooms.zilar.test')).toEqual([]);
  });

  it('resolves the group id of a legacy row for the mention memo', async () => {
    const { store } = await setup();
    store.getState().openChat(CHAT);
    await flush();

    // The legacy row (`baseSummaryForGroup`, no `topics`) carries no
    // `groupId` on the row, but the store resolves it through the
    // remembered `/api/chats` entries — the chat screen subscribes its
    // mention memo through this selector, so a cold open re-runs it when
    // the detail load lands instead of staying `[]` forever.
    expect(store.getState().groupIdForChat(CHAT)).toBe('g1');
    expect(store.getState().groupIdForChat('missing@rooms.zilar.test')).toBeUndefined();
  });

  it('passes [{ jid, begin, end }] to the core and keeps them on the bubble', async () => {
    const { store, xmpp } = await setup();
    const mentions = [{ jid: 'u-ana@zilar.test', name: 'Ana', begin: 3, end: 7 }];

    store.getState().sendText(CHAT, 'hi @ana', { mentions });
    await flush();

    expect(xmpp.sent).toEqual([
      expect.objectContaining({
        mentions: [{ jid: 'u-ana@zilar.test', begin: 3, end: 7 }],
      }),
    ]);
    expect(store.getState().messages(CHAT).at(-1)?.mentions).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana', begin: 3, end: 7 },
    ]);
  });

  it('sends no mentions option when the message carries none', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText(CHAT, 'hello there');
    await flush();

    expect(xmpp.sent).toEqual([undefined]);
    expect(store.getState().messages(CHAT).at(-1)?.mentions).toBeUndefined();
  });
});
