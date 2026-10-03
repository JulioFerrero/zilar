import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../lib/chat-api';
import type { VoicePort } from '../lib/voice';
import { VoiceError } from '../lib/voice';
import { voiceErrorCopy } from '../lib/voice-native';
import { createRealChatStore } from './real-store';
import type { SendVoiceRecording } from './types';

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: 'ana@zilar.test',
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
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
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
      service: 'ws://chat.zilar.test/ws',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  };
}

function fakeVoice(): VoicePort {
  return {
    convert: vi.fn(async (recording: { uri: string; durationMs: number; size: number }) => ({
      uri: recording.uri,
      mimeType: 'audio/mp4',
      size: recording.size,
      durationMs: 4321,
    })),
    upload: vi.fn(async () => 'https://upload.zilar.test/get/voice.m4a'),
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

const ANA = 'ana@zilar.test';

const RECORDING: SendVoiceRecording = {
  uri: 'file:///cache/rec.m4a',
  mimeType: 'audio/mp4',
  size: 120_000,
  durationMs: 9999,
  waveform: [10, 20, 30],
};

function uploaderFor() {
  return {
    upload: vi.fn(async () => undefined),
    cancel: vi.fn(),
  };
}

async function setup(voice?: VoicePort) {
  const api = fakeApi();
  const xmpp = fakeXmpp();
  const port = voice ?? fakeVoice();
  const uploader = uploaderFor();
  const store = createRealChatStore({
    api,
    appState: { current: () => 'active', subscribe: () => () => {} },
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    uploader,
    voice: port,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp, voice: port, uploader };
}

describe('real store sends voice messages (T-0154)', () => {
  it('converts, uploads and sends the voice payload with the server duration', async () => {
    const { store, xmpp, voice } = await setup();

    store.getState().sendVoice(ANA, RECORDING);
    const optimistic = store.getState().messages(ANA).at(-1);
    expect(optimistic?.voice?.duration_ms).toBe(9999);
    expect(optimistic?.voice?.url).toBe('file:///cache/rec.m4a');
    expect(optimistic?.status).toBe('sending');

    await flushUntil(
      () =>
        store.getState().messages(ANA).at(-1)?.voice?.url ===
        'https://upload.zilar.test/get/voice.m4a',
    );
    expect(voice.convert).toHaveBeenCalledTimes(1);
    expect(voice.upload).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(xmpp.core.sendMessage);
    expect(sent).toHaveBeenCalledWith(
      ANA,
      'chat',
      '',
      expect.objectContaining({ payload: expect.objectContaining({ type: 'voice' }) }),
    );
    const payload = sent.mock.calls[0]?.[3]?.payload;
    expect(payload).toEqual({
      v: 0,
      type: 'voice',
      data: {
        duration_ms: 4321,
        mime: 'audio/mp4',
        waveform: [10, 20, 30],
        url: 'https://upload.zilar.test/get/voice.m4a',
      },
    });
  });

  it('a conversion failure ends failed with a reason and keeps the recording for retry', async () => {
    const voice = fakeVoice();
    vi.mocked(voice.convert).mockRejectedValueOnce(new VoiceError('voice_failed', 'x'));
    const { store } = await setup(voice);

    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );
    // The optimistic bubble keeps its local metadata for the retry, and the
    // reason rides the message so the bubble renders the matching copy.
    const failed = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === localId);
    expect(failed?.voice?.duration_ms).toBe(9999);
    expect(failed?.voice?.waveform).toEqual([10, 20, 30]);
    expect(failed?.failureReason).toBe('server_unavailable');
    expect(voiceErrorCopy(failed?.failureReason ?? 'server_unavailable')).toContain(
      'Could not send',
    );

    store.getState().retryVoice(ANA, localId);
    await flushUntil(() => vi.mocked(voice.convert).mock.calls.length > 1);
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.status === 'sent',
    );
  });

  it('an offline failure ends failed with the network reason', async () => {
    const { store } = await setup();
    store.getState().stop();
    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );
    const failed = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === localId);
    expect(failed?.failureReason).toBe('network');
    expect(voiceErrorCopy('network')).toBe('Could not send. Check your connection.');
  });

  it('an over-limit failure ends failed with the too_large reason', async () => {
    const voice = fakeVoice();
    vi.mocked(voice.convert).mockRejectedValueOnce(new VoiceError('voice_too_large', 'x'));
    const { store } = await setup(voice);
    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );
    expect(
      store
        .getState()
        .messages(ANA)
        .find((item) => item.id === localId)?.failureReason,
    ).toBe('too_large');
    expect(voiceErrorCopy('too_large')).toBe('That recording is too long to send.');
  });

  it('an upload refusal ends failed with the upload_refused reason', async () => {
    const voice = fakeVoice();
    vi.mocked(voice.upload).mockRejectedValueOnce(new VoiceError('upload_failed', 'x'));
    const { store } = await setup(voice);
    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );
    expect(
      store
        .getState()
        .messages(ANA)
        .find((item) => item.id === localId)?.failureReason,
    ).toBe('upload_refused');
    expect(voiceErrorCopy('upload_refused')).toBe('Could not upload the recording.');
  });

  it('retries after a failed stanza send: the kept recording is still there', async () => {
    const { store, xmpp, voice } = await setup();
    vi.mocked(xmpp.core.sendMessage).mockRejectedValueOnce(new Error('stanza down'));

    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.failed === true,
    );

    store.getState().retryVoice(ANA, localId);
    await flushUntil(() => vi.mocked(xmpp.core.sendMessage).mock.calls.length > 1);
    expect(vi.mocked(voice.convert)).toHaveBeenCalledTimes(2);
    await flushUntil(
      () =>
        store
          .getState()
          .messages(ANA)
          .find((item) => item.id === localId)?.status === 'sent',
    );
  });

  it('merges the echo instead of duplicating the bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().sendVoice(ANA, RECORDING);
    await flushUntil(() => vi.mocked(xmpp.core.sendMessage).mock.calls.length > 0);

    xmpp.emit(
      'message',
      message({
        id: 'srv-voice-1',
        chatJid: ANA,
        body: '',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 4321,
            mime: 'audio/mp4',
            waveform: [10, 20, 30],
            url: 'https://upload.zilar.test/get/voice.m4a',
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const matches = store
      .getState()
      .messages(ANA)
      .filter((item) => item.voice !== undefined);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('srv-voice-1');
  });

  it('drops the audio URL of an incoming voice on an untrusted host', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'voice-untrusted',
        chatJid: ANA,
        body: '',
        timestamp: new Date('2026-09-28T12:03:00Z'),
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 1000,
            mime: 'audio/mp4',
            waveform: [5],
            url: 'https://evil.test/voice.m4a',
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const incoming = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === 'voice-untrusted');
    expect(incoming?.voice).toBeDefined();
    expect(incoming?.voice?.duration_ms).toBe(1000);
    expect(incoming?.voice?.url).toBeUndefined();
  });

  it('keeps the audio URL of an incoming voice on a trusted host', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'voice-trusted',
        chatJid: ANA,
        body: '',
        timestamp: new Date('2026-09-28T12:03:00Z'),
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 1000,
            mime: 'audio/mp4',
            waveform: [5],
            url: 'https://upload.zilar.test/upload/abc/voice.m4a',
          },
        } as unknown as ChatMessage['payload'],
      }),
    );
    const incoming = store
      .getState()
      .messages(ANA)
      .find((item) => item.id === 'voice-trusted');
    expect(incoming?.voice?.url).toBe('https://upload.zilar.test/upload/abc/voice.m4a');
  });

  it('cancels an in-flight voice upload by removing the bubble', async () => {
    const voice = fakeVoice();
    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve('https://upload.zilar.test/get/voice.m4a');
    });
    vi.mocked(voice.upload).mockImplementationOnce(() => gate);
    const { store } = await setup(voice);
    store.getState().sendVoice(ANA, RECORDING);
    const localId = store.getState().messages(ANA).at(-1)?.id ?? '';
    await flushUntil(() => vi.mocked(voice.upload).mock.calls.length > 0);

    store.getState().cancelVoice(ANA, localId);
    release();
    await flush();
    expect(
      store
        .getState()
        .messages(ANA)
        .find((item) => item.id === localId),
    ).toBeUndefined();
  });
});
