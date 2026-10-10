import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { flushTasks as flush, waitFor } from '@/test/wait';

const ANA = 'ana@zilar.test';

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

function fakeXmpp() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const core = {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'srv-c' })),
    sendRetraction: vi.fn(async () => {}),
    requestUploadSlot: vi.fn(async () => ({
      putUrl: 'https://upload.zilar.test/put/abc',
      getUrl: 'https://upload.zilar.test/get/abc',
      headers: { authorization: 'slot-token' },
    })),
    loadHistory: vi.fn(async () => ({ messages: [] as ChatMessage[], complete: true })),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: ((event: string, callback: (payload: unknown) => void) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
      };
    }) as unknown as XmppCore['on'],
  } as unknown as XmppCore;
  return {
    core,
    emit: (event: string, payload: unknown) => {
      for (const callback of listeners.get(event) ?? []) {
        callback(payload);
      }
    },
  };
}

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
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  };
}

function fakeUploader(): AttachmentUploader {
  return { upload: vi.fn(async () => {}), cancel: vi.fn() };
}

const PHOTO: PickedFile = {
  uri: 'file:///cache/photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 240_000,
  width: 1200,
  height: 800,
};

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api: fakeApi(),
    appState: { current: () => 'active', subscribe: () => () => {} },
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    uploader: fakeUploader(),
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, xmpp };
}

function reactionFromAna(targetId: string): ChatMessage {
  return {
    id: 'react-1',
    chatJid: ANA,
    kind: 'chat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-09-28T12:05:00Z'),
    outgoing: false,
    reactions: { targetId, emojis: ['👍'] },
  };
}

describe('real store ledger: what must not change (T-0906)', () => {
  it('links the optimistic id to the echo id, so a reaction naming the old id lands on the one bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendText(ANA, 'hello');
    await flush();

    xmpp.emit(
      'message',
      message({
        id: 'echo-1',
        chatJid: ANA,
        body: 'hello',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );
    xmpp.emit('message', reactionFromAna('local-1'));

    const bubbles = store
      .getState()
      .messages(ANA)
      .filter((item) => item.text === 'hello');
    expect(bubbles.map((item) => item.id)).toEqual(['echo-1']);
    expect(bubbles[0]?.reactions?.map((chip) => chip.emoji)).toEqual(['👍']);
  });

  it('resolves an edit that arrived before its target message loaded', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit('message', {
      id: 'corr-1',
      chatJid: ANA,
      kind: 'chat',
      fromJid: ANA,
      fromResolved: true,
      timestamp: new Date('2026-09-28T12:03:00Z'),
      outgoing: false,
      body: 'after',
      correction: { targetId: 'ana-late' },
    } satisfies ChatMessage);

    xmpp.emit(
      'message',
      message({
        id: 'ana-late',
        chatJid: ANA,
        body: 'before',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    const loaded = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === 'ana-late');
    expect(loaded?.text).toBe('after');
    expect(loaded?.edited).toBe(true);
  });

  it('strips the local upload preview when the message is retracted', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendAttachment(ANA, PHOTO, { caption: 'Stage!' });
    await waitFor(() => vi.mocked(xmpp.core.sendMessage).mock.calls.length > 0);
    await waitFor(() => store.getState().messages(ANA).at(-1)?.status === 'sent');
    const before = store.getState().messages(ANA).at(-1) as { localUri?: string } | undefined;
    expect(before?.localUri).toBe('file:///cache/photo.jpg');

    store.getState().deleteForEveryone(ANA, 'local-1');

    const after = store.getState().messages(ANA).at(-1) as
      | { deleted?: boolean; localUri?: string; uploadProgress?: number; attachment?: unknown }
      | undefined;
    expect(after?.deleted).toBe(true);
    expect(after?.localUri).toBeUndefined();
    expect(after?.uploadProgress).toBeUndefined();
    expect(after?.attachment).toBeUndefined();
  });
});

const TEAM = 'team@rooms.zilar.test';

async function setupGroup() {
  const api: ChatApi = {
    ...fakeApi(),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
      {
        kind: 'group' as const,
        chatJid: TEAM,
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'member' as const,
      },
    ]),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-ana', name: 'Ana', role: 'member' as const, roles: [] }],
      ais: [],
    })),
  };
  const ctx = await setup({ api });
  ctx.store.getState().openChat(TEAM);
  await flush();
  return ctx;
}

function outgoing(overrides: Partial<ChatMessage> & { chatJid: string; body: string }) {
  return message({ fromJid: 'me@zilar.test', outgoing: true, ...overrides });
}

describe('real store ledger: the core ledger expectations (T-0906)', () => {
  it('highlights a received mention under the group member name (R1, R2)', async () => {
    const { store, xmpp } = await setupGroup();

    xmpp.emit(
      'message',
      message({
        id: 'g-1',
        chatJid: TEAM,
        body: 'hey @ana look',
        fromJid: 'u-ana@zilar.test',
        fromNick: 'ana',
        mentions: [{ jid: 'u-ana@zilar.test', begin: 4, end: 8 }],
      }),
    );

    const received = store
      .getState()
      .messages(TEAM)
      .find((item) => item.id === 'g-1');
    expect(received?.mentions).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana', begin: 4, end: 8 },
    ]);
  });

  it('names the member in a corrected message, not the text at the range (R2)', async () => {
    const { store, xmpp } = await setupGroup();
    xmpp.emit(
      'message',
      message({
        id: 'g-2',
        chatJid: TEAM,
        body: 'hi',
        fromJid: 'u-ana@zilar.test',
        fromNick: 'ana',
      }),
    );

    xmpp.emit('message', {
      id: 'g-2-fix',
      chatJid: TEAM,
      kind: 'groupchat',
      fromJid: 'u-ana@zilar.test',
      fromNick: 'ana',
      fromResolved: true,
      timestamp: new Date('2026-09-28T10:05:00Z'),
      outgoing: false,
      body: 'hello @ana',
      correction: { targetId: 'g-2' },
      mentions: [{ jid: 'u-ana@zilar.test', begin: 6, end: 10 }],
    } satisfies ChatMessage);

    const edited = store
      .getState()
      .messages(TEAM)
      .find((item) => item.id === 'g-2');
    expect(edited?.text).toBe('hello @ana');
    expect(edited?.mentions).toEqual([{ jid: 'u-ana@zilar.test', name: 'Ana', begin: 6, end: 10 }]);
  });

  it('names the stanza id in a reaction when the group echo came before the ack (echo race)', async () => {
    const { store, xmpp } = await setupGroup();
    let acknowledge: (value: { id: string }) => void = () => {};
    vi.mocked(xmpp.core.sendMessage).mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          acknowledge = resolve;
        }),
    );

    store.getState().sendText(TEAM, 'race');
    await flush();
    xmpp.emit('message', outgoing({ id: 'stanza-1', chatJid: TEAM, body: 'race' }));
    acknowledge({ id: 'origin-1' });
    await flush();

    expect(
      store
        .getState()
        .messages(TEAM)
        .filter((item) => item.text === 'race'),
    ).toHaveLength(1);
    store.getState().react(TEAM, 'stanza-1', '👍');
    expect(vi.mocked(xmpp.core.sendReactions)).toHaveBeenCalledWith(TEAM, 'groupchat', 'stanza-1', [
      '👍',
    ]);
  });

  it('keeps naming the ack id in a DM when the echo came first', async () => {
    const { store, xmpp } = await setup();
    let acknowledge: (value: { id: string }) => void = () => {};
    vi.mocked(xmpp.core.sendMessage).mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          acknowledge = resolve;
        }),
    );

    store.getState().sendText(ANA, 'dm race');
    await flush();
    xmpp.emit('message', outgoing({ id: 'echo-dm', chatJid: ANA, body: 'dm race' }));
    acknowledge({ id: 'origin-dm' });
    await flush();

    store.getState().react(ANA, 'echo-dm', '👍');
    expect(vi.mocked(xmpp.core.sendReactions)).toHaveBeenCalledWith(ANA, 'chat', 'origin-dm', [
      '👍',
    ]);
  });
});
