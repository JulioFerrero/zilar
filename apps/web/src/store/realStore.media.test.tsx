import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import type { MediaPage } from '@/lib/api';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

// Sign-out must not hit Better Auth over the network in a test.
vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

// The server-owner answer is cached per session and must not outlive sign-out.
vi.mock('@/lib/useIsServerOwner', () => ({ resetIsServerOwnerCache: vi.fn() }));

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

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
  });
  store.getState().start();
  await flush();
  return { store, api };
}

function page(items: MediaPage['items']): MediaPage {
  return { items, next: null };
}

describe('real store media gallery (T-0434)', () => {
  it('drops the url of an image or gif on an untrusted host', async () => {
    const { store } = await setup({
      listChatMedia: vi.fn(async () =>
        page([
          {
            messageId: 'm-1',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:00:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://evil.test/tracker.png',
            name: 'tracker.png',
          },
          {
            messageId: 'm-2',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:01:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://upload.zilar.test/stage.png',
            name: 'stage.png',
          },
          {
            messageId: 'm-3',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:02:00.000Z',
            senderName: 'Ana',
            kind: 'gif',
            url: 'https://evil.test/loop.gif',
          },
          {
            messageId: 'm-4',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:03:00.000Z',
            senderName: 'Ana',
            kind: 'file',
            url: 'https://evil.test/tickets.pdf',
            name: 'tickets.pdf',
          },
        ]),
      ),
    });

    const result = await store.getState().loadChatMedia('ana@zilar.test', 'media');

    expect(result.items[0]?.url).toBeUndefined();
    expect(result.items[1]?.url).toBe('https://upload.zilar.test/stage.png');
    expect(result.items[2]?.url).toBeUndefined();
    // Files never auto-load, so their url is kept.
    expect(result.items[3]?.url).toBe('https://evil.test/tickets.pdf');
  });

  it('drops every image url when there is no XMPP token yet', async () => {
    const api = fakeApi({
      listChatMedia: vi.fn(async () =>
        page([
          {
            messageId: 'm-1',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:00:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://upload.zilar.test/stage.png',
            name: 'stage.png',
          },
        ]),
      ),
    });
    const store = createRealChatStore({ api, storage: memoryStorage() });

    const result = await store.getState().loadChatMedia('ana@zilar.test', 'media');

    expect(result.items[0]?.url).toBeUndefined();
  });
});
