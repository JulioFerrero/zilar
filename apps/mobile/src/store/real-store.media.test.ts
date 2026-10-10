import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import type { MediaApi, MediaItem } from '../lib/media-api';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';

function dmEntry(chatJid: string, title: string): ChatEntry {
  return { kind: 'dm', chatJid, title, userId: `u-${chatJid}` };
}

function dmApi(service: string, domain: string) {
  return fakeApi({
    getChats: vi.fn(async () => [dmEntry('ana@zilar.test', 'Ana')]),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service,
      domain,
      mucDomain: 'rooms.zilar.test',
    })),
  });
}

function mediaRow(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    messageId: 'm-1',
    chat: 'ana@zilar.test',
    at: '2026-09-30T11:00:00Z',
    senderName: 'Ana',
    kind: 'image',
    url: 'https://files.zilar.test/a.jpg',
    ...overrides,
  };
}

function fakeMedia(items: MediaItem[], next: string | null = null): MediaApi {
  return { listChatMedia: vi.fn(async () => ({ items, next })) } as unknown as MediaApi;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(media: MediaApi, service = 'ws://files.zilar.test', domain = 'zilar.test') {
  const api = dmApi(service, domain);
  const deps: Partial<RealStoreDeps> = {
    api,
    mediaApi: media,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
  };
  const store = createRealChatStore(deps);
  return { store, api };
}

describe('real store media gallery (T-0436)', () => {
  it('drops an untrusted image URL and keeps a trusted one', async () => {
    const media = fakeMedia([
      mediaRow({ messageId: 'm-untrusted', url: 'https://evil.test/tracker.gif' }),
      mediaRow({ messageId: 'm-trusted', url: 'https://files.zilar.test/photo.jpg' }),
    ]);
    const { store } = setup(media);
    store.getState().start();
    await flush();

    const page = await store.getState().loadChatMedia('ana@zilar.test', 'media');
    expect(page.items.find((item) => item.messageId === 'm-untrusted')?.url).toBeUndefined();
    expect(page.items.find((item) => item.messageId === 'm-trusted')?.url).toBe(
      'https://files.zilar.test/photo.jpg',
    );
    expect(media.listChatMedia).toHaveBeenCalledWith({
      chat: 'ana@zilar.test',
      type: 'media',
    });
    store.getState().stop();
  });

  it('resolves a server-relative URL against the API origin', async () => {
    // The API origin is trusted when the XMPP service host matches it.
    const media = fakeMedia([mediaRow({ messageId: 'm-relative', url: '/api/media/abc.jpg' })]);
    const { store } = setup(media, 'ws://127.0.0.1:3188');
    store.getState().start();
    await flush();

    const page = await store.getState().loadChatMedia('ana@zilar.test', 'media');
    expect(page.items[0]?.url).toBe('http://127.0.0.1:3188/api/media/abc.jpg');
    store.getState().stop();
  });

  it('keeps the paging cursor and passes before through', async () => {
    const media = fakeMedia([], '1700000000000000');
    const { store } = setup(media);
    store.getState().start();
    await flush();

    const page = await store.getState().loadChatMedia('ana@zilar.test', 'files', '1700');
    expect(page.next).toBe('1700000000000000');
    expect(media.listChatMedia).toHaveBeenCalledWith({
      chat: 'ana@zilar.test',
      type: 'files',
      before: '1700',
    });
    store.getState().stop();
  });

  it('keeps a file URL without a trust check', async () => {
    const media = fakeMedia([
      mediaRow({
        messageId: 'm-file',
        kind: 'file',
        url: 'https://files.example.com/docs/report.pdf',
      }),
    ]);
    const { store } = setup(media);
    store.getState().start();
    await flush();

    const page = await store.getState().loadChatMedia('ana@zilar.test', 'files');
    expect(page.items[0]?.url).toBe('https://files.example.com/docs/report.pdf');
    store.getState().stop();
  });
});
