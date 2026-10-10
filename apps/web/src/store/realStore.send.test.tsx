import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps, type StorageLike } from './realStore';

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const PACK = '123e4567-e89b-12d3-a456-426614174000';
const STICKER = '223e4567-e89b-12d3-a456-426614174001';

const sticker = {
  stickerId: STICKER,
  packId: PACK,
  url: 'https://cdn.zilar.test/cat.webp',
  emoji: '🐱',
  width: 128,
  height: 128,
  mime: 'image/webp' as const,
};

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

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

function rejection(code: string): Error {
  return Object.assign(new Error(code), { code });
}

afterEach(() => {
  vi.useRealTimers();
});

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi();
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp };
}

const attachmentPort = (overrides: Partial<RealStoreDeps['attachments']> = {}) => ({
  classify: () => 'file' as const,
  readImageSize: async () => undefined,
  upload: async () => 'https://upload.zilar.test/get/1',
  ...overrides,
});

const voicePort = (overrides: Partial<RealStoreDeps['voice']> = {}) => ({
  convert: async () => ({ audio: new Blob([new Uint8Array([1])]), durationMs: 4321 }),
  upload: async () => 'https://upload.zilar.test/get/1/voice.m4a',
  ...overrides,
});

describe('web send pipeline (T10 guards)', () => {
  it('sends text and links the echo without duplicating it', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText(ANA, 'hello there');
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sending');

    await flush();
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sent');

    xmpp.emit(
      'message',
      message({
        id: 'srv-9',
        chatJid: ANA,
        body: 'hello there',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );
    const matches = store
      .getState()
      .messages(ANA)
      ?.filter((item) => item.text === 'hello there');
    expect(matches).toHaveLength(1);
  });

  it('sends a sticker payload', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendSticker(ANA, sticker);
    await flush();

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(ANA, 'chat', '🐱', {
      payload: {
        v: 0,
        type: 'sticker',
        data: expect.objectContaining({ sticker_id: STICKER, pack_id: PACK, emoji: '🐱' }),
      },
    });
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sent');
  });

  it('uploads an attachment and swaps in the served url', async () => {
    const { store, xmpp } = await setup({ attachments: attachmentPort() });
    const file = new File(['abc'], 'report.pdf', { type: 'application/pdf' });

    store.getState().sendAttachment(ANA, file, { caption: 'the report' });
    await flush();

    expect(store.getState().messages(ANA)?.at(-1)?.attachment?.url).toBe(
      'https://upload.zilar.test/get/1',
    );
    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(
      ANA,
      'chat',
      'the report',
      expect.objectContaining({ payload: expect.objectContaining({ type: 'attachment' }) }),
    );
  });

  it('returns silently on a size-0 file, before any request (R19)', async () => {
    const { store, xmpp } = await setup({ attachments: attachmentPort() });

    store.getState().sendAttachment(ANA, new File([], 'empty.txt', { type: 'text/plain' }));
    await flush();

    expect(xmpp.core.sendMessage).not.toHaveBeenCalled();
    expect(
      store
        .getState()
        .messages(ANA)
        ?.some((item) => item.attachment !== undefined),
    ).toBe(false);
  });

  it('converts and uploads a voice message', async () => {
    const { store } = await setup({ voice: voicePort() });

    store.getState().sendVoice(ANA, {
      blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
      durationMs: 9999,
      waveform: [1, 2, 3],
    });
    await flush();

    const sent = store.getState().messages(ANA)?.at(-1);
    expect(sent?.voice?.duration_ms).toBe(4321);
    expect(sent?.voice?.url).toBe('https://upload.zilar.test/get/1/voice.m4a');
    expect(sent?.status).toBe('sent');
  });

  it('forwards a sent message into another chat', async () => {
    const { store } = await setup();
    store.getState().sendText(ANA, 'forward me');
    await flush();
    const source = store
      .getState()
      .messages(ANA)
      ?.find((item) => item.text === 'forward me');
    expect(source).toBeDefined();

    store.getState().forwardMessages([TEAM], source === undefined ? [] : [source]);
    await flush();

    const copy = store.getState().messages(TEAM)?.at(-1);
    expect(copy?.text).toBe('forward me');
    expect(copy?.forward?.sender_name).toBe('You');
  });

  it('marks a failed attachment send failed with its reason', async () => {
    const { store } = await setup({
      attachments: attachmentPort({
        upload: async () => Promise.reject(rejection('upload_refused')),
      }),
    });

    store
      .getState()
      .sendAttachment(ANA, new File(['abc'], 'report.pdf', { type: 'application/pdf' }));
    await flush();

    const bubble = store.getState().messages(ANA)?.at(-1);
    expect(bubble?.status).toBe('failed');
    expect(bubble?.failureReason).toBe('upload_refused');
  });

  it('retries a failed attachment', async () => {
    let fail = true;
    const { store } = await setup({
      attachments: attachmentPort({
        upload: async () => {
          if (fail) {
            throw rejection('network_error');
          }
          return 'https://upload.zilar.test/get/2';
        },
      }),
    });

    store
      .getState()
      .sendAttachment(ANA, new File(['abc'], 'report.pdf', { type: 'application/pdf' }));
    await flush();
    const failed = store.getState().messages(ANA)?.at(-1);
    expect(failed?.status).toBe('failed');

    fail = false;
    store.getState().retryAttachment(ANA, failed?.id ?? '');
    await flush();
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sent');
  });

  it('deletes a failed attachment', async () => {
    const { store } = await setup({
      attachments: attachmentPort({
        upload: async () => Promise.reject(rejection('network_error')),
      }),
    });

    store
      .getState()
      .sendAttachment(ANA, new File(['abc'], 'report.pdf', { type: 'application/pdf' }));
    await flush();
    const failed = store.getState().messages(ANA)?.at(-1);
    expect(failed?.status).toBe('failed');

    store.getState().deleteFailedMessage(ANA, failed?.id ?? '');
    expect(
      store
        .getState()
        .messages(ANA)
        ?.some((item) => item.id === failed?.id),
    ).toBe(false);
  });
});

describe('web send pipeline (R20)', () => {
  it('clears a stale error banner on the next send', async () => {
    const { store } = await setup();

    store.getState().sendSticker(ANA, { ...sticker, url: '/evil/track.png' });
    expect(store.getState().actionError).toEqual({
      chatId: ANA,
      message: 'That sticker could not be sent.',
    });

    store.getState().sendSticker(ANA, sticker);
    expect(store.getState().actionError).toBeUndefined();
  });
});
