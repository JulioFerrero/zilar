import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps, type StorageLike } from './realStore';

const ANA = 'ana@zilar.test';

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

describe('web send pipeline (T10 guards)', () => {
  it('sends text and links the echo without duplicating it', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText(ANA, 'hello there');
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sending');

    await flush();
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sending');

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
    expect(store.getState().messages(ANA)?.at(-1)?.status).toBe('sent');
    const matches = store
      .getState()
      .messages(ANA)
      ?.filter((item) => item.text === 'hello there');
    expect(matches).toHaveLength(1);
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
