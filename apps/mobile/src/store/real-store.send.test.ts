import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';
import type { ConvertedVoice, VoicePort } from '../lib/voice';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi } from './test-support';
import { flushTasks as flush, waitFor } from '@/test/wait';

const ANA = 'ana@zilar.test';

const PHOTO: PickedFile = {
  uri: 'file:///cache/photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 240_000,
  width: 1200,
  height: 800,
};

function anaApi(): ChatApi {
  return fakeApi({
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
  }) as unknown as ChatApi;
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
    requestUploadSlot: vi.fn(async () => ({
      putUrl: 'https://upload.zilar.test/put/abc',
      getUrl: 'https://upload.zilar.test/get/abc',
      headers: { authorization: 'slot-token' },
    })),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
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

async function started(deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api: anaApi(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    ...deps,
  });
  store.getState().start();
  await flush();
  await flush();
  return { store, xmpp };
}

function textEcho(id: string, body: string): ChatMessage {
  return {
    id,
    chatJid: ANA,
    kind: 'chat',
    fromJid: 'me@zilar.test',
    fromResolved: true,
    timestamp: new Date('2026-09-28T12:02:00Z'),
    outgoing: true,
    body,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mobile send pipeline on the core (T10b)', () => {
  it('sends a plain text with no options and waits for the ack for sent', async () => {
    const { store, xmpp } = await started();

    store.getState().sendText(ANA, 'hello there');
    // Mobile keeps `undefined` options for a plain text (web pins `{}`).
    expect(vi.mocked(xmpp.core.sendMessage)).toHaveBeenCalledWith(
      ANA,
      'chat',
      'hello there',
      undefined,
    );
    await flush();
    // The socket write alone does not confirm: the bubble waits for the
    // server's stream-management ack (the honest tick, F4).
    expect(store.getState().messages(ANA).at(-1)?.status).toBe('sending');

    xmpp.emit('acked', { stanzaId: 'srv-1' });
    await waitFor(() => expect(store.getState().messages(ANA).at(-1)?.status).toBe('sent'));

    xmpp.emit('message', textEcho('srv-1', 'hello there'));
    await flush();
    const matches = store
      .getState()
      .messages(ANA)
      .filter((item) => item.text === 'hello there');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('srv-1');

    store.getState().stop();
  });

  it('does not deliver a photo cancelled while its upload is in flight', async () => {
    let finishUpload!: () => void;
    const uploader: AttachmentUploader = {
      upload: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishUpload = resolve;
          }),
      ),
      cancel: vi.fn(),
    };
    const { store, xmpp } = await started({ uploader });

    store.getState().sendAttachment(ANA, PHOTO);
    const bubble = store.getState().messages(ANA).at(-1);
    expect(bubble?.attachment).toBeDefined();

    // Cancel while the PUT is in flight (the slot request already resolved).
    await waitFor(() => vi.mocked(uploader.upload).mock.calls.length > 0);
    store.getState().cancelAttachment(ANA, bubble?.id ?? '');
    expect(store.getState().messages(ANA)).toHaveLength(0);

    // The PUT finishes after the cancel: the bytes went up, but no stanza may.
    finishUpload();
    await flush();
    await flush();

    expect(vi.mocked(xmpp.core.sendMessage)).not.toHaveBeenCalled();
    expect(store.getState().messages(ANA)).toHaveLength(0);

    store.getState().stop();
  });

  it('does not deliver a voice note cancelled while it converts', async () => {
    let finishConvert!: (converted: ConvertedVoice) => void;
    const voice: VoicePort = {
      convert: vi.fn(
        () =>
          new Promise<ConvertedVoice>((resolve) => {
            finishConvert = resolve;
          }),
      ),
      upload: vi.fn(async () => 'https://upload.zilar.test/get/voice'),
    };
    const { store, xmpp } = await started({ voice });

    store.getState().sendVoice(ANA, {
      uri: 'file:///cache/voice.m4a',
      mimeType: 'audio/mp4',
      size: 2048,
      durationMs: 1500,
      waveform: [10],
    });
    const bubble = store.getState().messages(ANA).at(-1);
    expect(bubble?.voice).toBeDefined();

    // Cancel while the conversion request is in flight.
    await waitFor(() => vi.mocked(voice.convert).mock.calls.length > 0);
    store.getState().cancelVoice(ANA, bubble?.id ?? '');
    expect(store.getState().messages(ANA)).toHaveLength(0);

    // The conversion finishes after the cancel: neither the upload nor the
    // stanza may run.
    finishConvert({
      uri: 'file:///cache/converted.m4a',
      mimeType: 'audio/mp4',
      size: 2048,
      durationMs: 1500,
    });
    await flush();
    await flush();

    expect(vi.mocked(voice.upload)).not.toHaveBeenCalled();
    expect(vi.mocked(xmpp.core.sendMessage)).not.toHaveBeenCalled();

    store.getState().stop();
  });
});
