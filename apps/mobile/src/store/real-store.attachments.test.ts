import type { ChatMessage, XmppCore } from '@galena/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';
import { createRealChatStore, type RealStoreDeps } from './real-store';

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: 'ana@galena.test',
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
    me: () => 'me@galena.test',
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
      putUrl: 'https://upload.galena.test/put/abc',
      getUrl: 'https://upload.galena.test/get/abc',
      headers: { authorization: 'slot-token' },
    })),
    loadHistory: vi.fn(async (chatJid: string) => ({
      messages: [
        message({
          id: 'ana-1',
          chatJid,
          body: 'older',
          timestamp: new Date('2026-09-28T09:00:00Z'),
        }),
      ],
      complete: true,
      first: 'ana-1',
    })),
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
      email: 'me@galena.test',
      name: 'Me',
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
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
      jid: 'me@galena.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://chat.galena.test/ws',
      domain: 'galena.test',
      mucDomain: 'rooms.galena.test',
    })),
  };
}

function fakeUploader(): AttachmentUploader {
  return {
    upload: vi.fn(
      async (
        _file: PickedFile,
        _slot: { putUrl: string; headers: Record<string, string> },
        onProgress?: (fraction: number) => void,
      ) => {
        onProgress?.(0.5);
      },
    ),
    cancel: vi.fn(),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let round = 0; round < 50 && !predicate(); round += 1) {
    await flush();
  }
}

const ANA = 'ana@galena.test';

const PHOTO: PickedFile = {
  uri: 'file:///cache/photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 240_000,
  width: 1200,
  height: 800,
};

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi();
  const xmpp = fakeXmpp();
  const uploader = fakeUploader();
  const store = createRealChatStore({
    api,
    appState: { current: () => 'active', subscribe: () => () => {} },
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    uploader,
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp, uploader };
}

describe('real store sends attachments (T-0150)', () => {
  it('requests a slot on the chat session, PUTs with the slot headers, and sends the wire payload', async () => {
    const { store, xmpp, uploader } = await setup();

    store.getState().sendAttachment(ANA, PHOTO, { caption: 'Stage!' });
    const optimistic = store.getState().messages(ANA).at(-1);
    expect(optimistic?.attachment).toMatchObject({ kind: 'image', name: 'photo.jpg' });
    expect(optimistic?.attachment?.url).toBe('file:///cache/photo.jpg');
    expect(optimistic?.text).toBe('Stage!');
    expect(optimistic?.status).toBe('sending');

    await flushUntil(
      () =>
        store.getState().messages(ANA).at(-1)?.attachment?.url ===
        'https://upload.galena.test/get/abc',
    );
    expect(vi.mocked(xmpp.core.requestUploadSlot)).toHaveBeenCalledWith({
      filename: 'photo.jpg',
      size: 240_000,
      contentType: 'image/jpeg',
    });
    expect(uploader.upload).toHaveBeenCalledWith(
      PHOTO,
      {
        putUrl: 'https://upload.galena.test/put/abc',
        headers: { authorization: 'slot-token' },
      },
      expect.any(Function),
    );
    const sent = vi.mocked(xmpp.core.sendMessage);
    expect(sent).toHaveBeenCalledWith(
      ANA,
      'chat',
      'Stage!',
      expect.objectContaining({ payload: expect.objectContaining({ type: 'attachment' }) }),
    );
    const payload = sent.mock.calls[0]?.[3]?.payload;
    expect(payload).toEqual({
      v: 0,
      type: 'attachment',
      data: {
        kind: 'image',
        url: 'https://upload.galena.test/get/abc',
        name: 'photo.jpg',
        size: 240_000,
        mime: 'image/jpeg',
        width: 1200,
        height: 800,
      },
    });
  });

  it('merges the echo instead of duplicating the bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendAttachment(ANA, PHOTO, { caption: 'Stage!' });
    await flushUntil(() => vi.mocked(xmpp.core.sendMessage).mock.calls.length > 0);

    xmpp.emit(
      'message',
      message({
        id: 'srv-attachment-1',
        chatJid: ANA,
        body: 'Stage!',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.galena.test/get/abc',
            name: 'photo.jpg',
            size: 240_000,
            mime: 'image/jpeg',
            width: 1200,
            height: 800,
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const matches = store
      .getState()
      .messages(ANA)
      .filter((item) => item.attachment !== undefined);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('srv-attachment-1');
  });

  it('marks a refused upload failed and retries it from the kept bytes', async () => {
    const { store, xmpp, uploader } = await setup();
    vi.mocked(xmpp.core.requestUploadSlot).mockRejectedValueOnce(new Error('refused'));

    store.getState().sendAttachment(ANA, PHOTO);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );
    expect(uploader.upload).not.toHaveBeenCalled();

    store.getState().retryAttachment(ANA, localId);
    await flushUntil(() => vi.mocked(xmpp.core.sendMessage).mock.calls.length > 0);
    expect(vi.mocked(xmpp.core.requestUploadSlot)).toHaveBeenCalledTimes(2);
    expect(
      store
        .getState()
        .messages(ANA)
        .find((item) => item.id === localId)?.failed,
    ).toBeUndefined();
  });

  it('refuses empty and oversized files inline with no bubble', async () => {
    const { store, xmpp } = await setup();
    const before = store.getState().messages(ANA).length;

    store.getState().sendAttachment(ANA, { ...PHOTO, size: 0 });
    expect(store.getState().messages(ANA)).toHaveLength(before);
    expect(store.getState().actionError).toEqual({ chatId: ANA, message: 'That file is empty.' });

    store.getState().sendAttachment(ANA, { ...PHOTO, size: 60 * 1024 * 1024 });
    expect(store.getState().messages(ANA)).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: ANA,
      message: 'That file is larger than 50 MB.',
    });
    expect(vi.mocked(xmpp.core.requestUploadSlot)).not.toHaveBeenCalled();
    await flush();
  });

  it('cancels an in-flight upload by removing the bubble', async () => {
    const { store, uploader } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(uploader.upload).mockImplementationOnce(() => gate.then(() => undefined));
    store.getState().sendAttachment(ANA, PHOTO);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(() => vi.mocked(uploader.upload).mock.calls.length > 0);

    store.getState().cancelAttachment(ANA, localId);
    release();
    await flush();
    expect(vi.mocked(uploader.cancel)).toHaveBeenCalled();
    expect(
      store
        .getState()
        .messages(ANA)
        .find((item) => item.id === localId),
    ).toBeUndefined();
  });

  it('downgrades an incoming image on an untrusted host to a file row', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'srv-in-1',
        chatJid: ANA,
        body: 'look',
        timestamp: new Date('2026-09-28T12:03:00Z'),
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://evil.test/x.png',
            name: 'x.png',
            size: 100,
            mime: 'image/png',
            width: 10,
            height: 10,
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const incoming = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === 'srv-in-1');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment).not.toHaveProperty('width');
  });

  it('keeps an incoming image on the trusted upload host', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'srv-in-2',
        chatJid: ANA,
        body: '',
        timestamp: new Date('2026-09-28T12:03:00Z'),
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.galena.test/get/abc',
            name: 'stage.png',
            size: 100,
            mime: 'image/png',
            width: 10,
            height: 10,
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const incoming = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === 'srv-in-2');
    expect(incoming?.attachment?.kind).toBe('image');
  });

  it('publishes the trusted media hosts from the XMPP token', async () => {
    const { store } = await setup();
    const hosts = store.getState().mediaTrustedHosts;
    expect(hosts?.has('chat.galena.test')).toBe(true);
    expect(hosts?.has('galena.test')).toBe(true);
    expect(hosts?.has('upload.galena.test')).toBe(true);
  });
});
